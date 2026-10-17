"""Validate StarUML structure and the editorial model; no backend simulation.

Usage: python scripts/validate_erd.py [--baseline-git REV]
"""

import argparse
import json
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDITORIAL = {
    'editorial_entities', 'change_proposals', 'proposal_changes',
    'change_dependencies', 'proposal_sources', 'change_sources',
    'change_decisions', 'entity_revisions', 'user_role_changes',
    'user_status_changes',
}
ROOTS = {
    'catalog_identities': 'identity', 'works': 'work',
    'recordings': 'recording', 'releases': 'release',
    'events': 'event', 'tours': 'tour',
}


def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def inside_segment(p, q, rect):
    left, top, right, bottom = rect
    if p[0] == q[0]:
        return left < p[0] < right and max(min(p[1], q[1]), top) < min(max(p[1], q[1]), bottom)
    if p[1] == q[1]:
        return top < p[1] < bottom and max(min(p[0], q[0]), left) < min(max(p[0], q[0]), right)
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-git', metavar='REV', help='Previous Git revision for domain preservation checks')
    args = parser.parse_args()
    project = json.loads((ROOT / 'ERDiagram.mdj').read_text(encoding='utf-8'))
    objects = list(walk(project))
    counts = Counter(o['_id'] for o in objects if '_id' in o)
    errors = []

    def check(condition, message):
        if not condition:
            errors.append(message)

    check(all(n == 1 for n in counts.values()), 'Duplicate object IDs')
    by_id = {o['_id']: o for o in objects if '_id' in o}
    for obj in objects:
        if '$ref' in obj:
            check(obj['$ref'] in by_id, f"Unresolved reference: {obj['$ref']}")
    if errors:
        raise SystemExit('\n'.join(errors))

    tables = {o['name']: o for o in objects if o.get('_type') == 'ERDEntity'}
    check(len(tables) == sum(o.get('_type') == 'ERDEntity' for o in objects), 'Duplicate table names')
    check(EDITORIAL <= tables.keys(), 'Missing editorial tables')
    check('artist_team_members' not in tables, 'Legacy artist team table remains')
    check('organization_memberships' in tables and 'artist_organization_affiliations' in tables, 'Musical memberships missing')
    model = next(o for o in project['ownedElements'] if o.get('name') == 'Editorial Contributions')
    check({o['name'] for o in model['ownedElements'] if o['_type'] == 'ERDEntity'} == EDITORIAL, 'Editorial model has unexpected tables')
    columns = {name: {c['name']: c for c in t['columns']} for name, t in tables.items()}
    for name, table in tables.items():
        check(len(columns[name]) == len(table['columns']), f'Duplicate columns: {name}')
        for c in table['columns']:
            check(c['_parent']['$ref'] == table['_id'], f'Wrong column parent: {name}.{c["name"]}')
    for name, kind in ROOTS.items():
        c = columns[name].get('editorial_entity_id', {})
        check(c.get('type') == 'UUID' and c.get('foreignKey') and c.get('unique') and not c.get('nullable'), f'Invalid root FK: {name}')
        check(f'entity_type={kind}' in c.get('documentation', ''), f'Root type constraint missing: {name}')
    for name in ['artists', 'tracks', 'people', 'organizations']:
        check('editorial_entity_id' not in columns[name], f'Duplicate editorial ownership: {name}')
    check('user | moderator | admin' in columns['users']['role']['documentation'], 'Missing global moderator role')

    # Expected FK targets; bridge/composite semantics are checked in documentation below.
    links = {
        ('editorial_entities','created_by'): 'users',
        ('editorial_entities','creation_change_id'): 'proposal_changes',
        ('change_proposals','author_id'): 'users',
        ('change_proposals','previous_proposal_id'): 'change_proposals',
        ('proposal_changes','proposal_id'): 'change_proposals',
        ('proposal_changes','entity_id'): 'editorial_entities',
        ('change_dependencies','change_id'): 'proposal_changes',
        ('change_dependencies','depends_on_change_id'): 'proposal_changes',
        ('proposal_sources','proposal_id'): 'change_proposals',
        ('change_sources','change_id'): 'proposal_changes',
        ('change_sources','source_id'): 'proposal_sources',
        ('change_decisions','change_id'): 'proposal_changes',
        ('change_decisions','actor_id'): 'users',
        ('entity_revisions','entity_id'): 'editorial_entities',
        ('entity_revisions','change_id'): 'proposal_changes',
        ('entity_revisions','decision_id'): 'change_decisions',
        ('user_role_changes','user_id'): 'users',
        ('user_role_changes','changed_by'): 'users',
        ('user_status_changes','user_id'): 'users',
        ('user_status_changes','changed_by'): 'users',
    }
    relations = [o for o in objects if o.get('_type') == 'ERDRelationship']
    pairs = set()
    for r in relations:
        ends = [r['end1'], r['end2']]
        for end in ends:
            check(end['_parent']['$ref'] == r['_id'], 'Wrong relationship end parent')
            check(by_id[end['reference']['$ref']]['_type'] == 'ERDEntity', 'Relationship does not target entity')
            check(end.get('cardinality', '1') in {'1','0..1','0..*','1..*'}, 'Unsupported cardinality')
        pairs.add(tuple(by_id[e['reference']['$ref']]['name'] for e in ends))
    for (child, column), parent in links.items():
        c = columns[child].get(column, {})
        check(c.get('foreignKey'), f'Missing FK flag: {child}.{column}')
        check(c.get('type') == ('INTEGER' if parent == 'users' else 'UUID'), f'Wrong FK type: {child}.{column}')
        check((parent,child) in pairs, f'Missing modeled relationship: {parent} -> {child}')
    for root in ROOTS:
        check(('editorial_entities',root) in pairs, f'Missing publication relationship: {root}')
    for name in EDITORIAL:
        check('ON DELETE RESTRICT' in tables[name]['documentation'], f'Missing retention policy: {name}')
    for name in ['change_sources','change_dependencies']:
        check('(proposal_id,change_id)' in tables[name]['documentation'], f'Missing composite proposal FK: {name}')
    for col_name in ['change_id','decision_id']:
        check(columns['entity_revisions'][col_name].get('unique'), f'No idempotency constraint: {col_name}')
    check(columns['editorial_entities']['creation_change_id'].get('nullable'), 'Creation cycle cannot be reserved')

    diagrams = [o for o in objects if o.get('_type') == 'ERDDiagram']
    new_diagrams = [d for d in diagrams if d['_parent']['$ref'] == model['_id']]
    check(len(new_diagrams) == 4, 'Expected four editorial diagrams')
    visible_relations, visible_tables = set(), set()
    for d in diagrams:
        local = {v['_id']:v for v in d['ownedViews']}
        nodes = [v for v in d['ownedViews'] if v['_type'] == 'ERDEntityView']
        is_new = d in new_diagrams
        for v in d['ownedViews']:
            check(v['_parent']['$ref'] == d['_id'], 'Incorrect view parent')
            if v['_type'] == 'ERDEntityView':
                table = by_id[v['model']['$ref']]
                check(table['_type'] == 'ERDEntity', 'Entity view targets non-entity')
                if is_new:
                    visible_tables.add(table['name'])
                compartment = by_id[v['columnCompartment']['$ref']]
                check(compartment['model'] == v['model'], 'Wrong compartment model')
                represented = [c['model']['$ref'] for c in compartment['subViews']]
                if is_new or table['name'] in ROOTS:
                    check(represented == [c['_id'] for c in table['columns']], f'Incomplete/incorrect column views: {table["name"]} in {d["name"]}')
                if is_new:
                    check(compartment['top']+compartment['height'] <= v['top']+v['height'], 'Clipped compartment')
                    for cv in compartment['subViews']:
                        check(cv['top']+cv['height'] <= compartment['top']+compartment['height'], 'Clipped column')
            if v['_type'] == 'ERDRelationshipView':
                r = by_id[v['model']['$ref']]
                check(r['_type'] == 'ERDRelationship', 'Edge view targets non-relationship')
                check(v['head']['$ref'] in local and v['tail']['$ref'] in local, 'Edge endpoint outside diagram')
                tail, head = local[v['tail']['$ref']], local[v['head']['$ref']]
                check(tail['model'] == r['end1']['reference'] and head['model'] == r['end2']['reference'], 'Edge reversed or wrong endpoints')
                if is_new:
                    visible_relations.add(r['_id'])
                    points = [tuple(map(int,p.split(':'))) for p in v['points'].split(';')]
                    for p,q in zip(points,points[1:]):
                        check(p[0] == q[0] or p[1] == q[1], 'Non-orthogonal editorial edge')
                        for n in nodes:
                            rect = (n['left'],n['top'],n['left']+n['width'],n['top']+n['height'])
                            check(not inside_segment(p,q,rect), f'Edge crosses table in {d["name"]}')
        if is_new:
            for i,a in enumerate(nodes):
                for b in nodes[i+1:]:
                    overlap = (max(a['left'],b['left']) < min(a['left']+a['width'],b['left']+b['width']) and max(a['top'],b['top']) < min(a['top']+a['height'],b['top']+b['height']))
                    check(not overlap, f'Overlapping tables: {d["name"]}')
    check(EDITORIAL | ROOTS.keys() <= visible_tables, 'Missing editorial/publication table views')
    for r in relations:
        names = {by_id[r[end]['reference']['$ref']]['name'] for end in ['end1','end2']}
        if names & EDITORIAL:
            check(r['_id'] in visible_relations, f'Editorial relationship never drawn: {r["name"]}')
    serialized = json.dumps(project)
    for obsolete in ['wiki_pages', 'docs/wiki-model.md', 'Mandatory independent review', 'Mandatory independent event-team review']:
        check(obsolete not in serialized, f'Obsolete policy: {obsolete}')

    if args.baseline_git:
        raw = subprocess.check_output(['git','show',f'{args.baseline_git}:ERDiagram.mdj'],cwd=ROOT)
        before = json.loads(raw.decode('utf-8'))
        old_objects = list(walk(before))
        old_tables = {o['name']:o for o in old_objects if o.get('_type') == 'ERDEntity'}
        check(tables.keys() - old_tables.keys() == EDITORIAL, 'Unexpected added tables')
        check(old_tables.keys() - tables.keys() == {'artist_team_members'}, 'Unexpected deleted tables')
        def structural(obj):
            return {k:v for k,v in obj.items() if k not in {'documentation','ownedElements','columns'}}
        team_id = old_tables['artist_team_members']['_id']
        for name, old in old_tables.items():
            if name == 'artist_team_members':
                continue
            current = tables[name]
            check(structural(old) == structural(current), f'Changed existing table structure: {name}')
            old_cols = {c['name']:c for c in old['columns']}
            check(columns[name].keys() - old_cols.keys() == ({'editorial_entity_id'} if name in ROOTS else set()), f'Unexpected new columns: {name}')
            check(old_cols.keys() <= columns[name].keys(), f'Removed domain columns: {name}')
            for column, c in old_cols.items():
                check(structural(c) == structural(columns[name][column]), f'Changed existing column: {name}.{column}')
                if column in {'source_text','source_url'}:
                    check(c == columns[name][column], f'Changed source field: {name}.{column}')
        for r in old_objects:
            if r.get('_type') == 'ERDRelationship':
                touches_team = any(r[end]['reference']['$ref'] == team_id for end in ['end1','end2'])
                check((r['_id'] not in by_id) if touches_team else by_id.get(r['_id']) == r, f'Unexpected existing relationship change: {r.get("name")}')

    if errors:
        for error in errors:
            print('FAIL:',error)
        raise SystemExit(1)
    print(f'PASS: {len(tables)} tables, {len(counts)} unique IDs, {len(diagrams)} diagrams; all references valid.')
    print('PASS: editorial FKs, compound-key documentation, cardinalities, complete views and non-overlapping routed geometry.')
    if args.baseline_git:
        print('PASS: existing domain columns, keys, sources and non-team relationships preserved against',args.baseline_git)
    print('LIMIT: static ER validation only; SQL constraints, permissions and concurrency require a backend implementation.')


if __name__ == '__main__':
    main()
