import { INestApplicationContext } from '@nestjs/common';
import { User } from '../accounts/entities/user.entity';
import { DecisionInput, DecisionsService } from '../editorial/decisions.service';
import { isStaff } from '../editorial/editorial-access';
import { EditorialEntitiesService } from '../editorial/editorial-entities.service';
import { EditorialEntityType } from '../editorial/entities/editorial-entity.entity';
import { ProposalChangesService } from '../editorial/proposal-changes.service';
import { ProposalSourcesService } from '../editorial/proposal-sources.service';
import { ProposalsService } from '../editorial/proposals.service';

/** A member of a target key naming the insertion of the same proposal labelled `insertion`, before it exists. */
export interface InsertionReference {
  insertion: string;
}

/** A microchange as a draft adds it: absence when `value` is undefined. */
export interface SeedChange {
  entityId: string;
  operation: 'create_entity' | 'set_fields' | 'add_relation' | 'withdraw_entity';
  targetPath: string;
  /** Its members may name an earlier insertion of the proposal by its label. */
  targetKey?: Record<string, unknown>;
  value?: unknown;
  /** How later microchanges of the same proposal name this insertion. */
  label?: string;
}

/** What a proposal of the seed says and who sends it. */
export interface SeedProposal {
  author: User;
  description: string;
  /** URLs of the general sources. */
  sources: string[];
  changes: SeedChange[];
}

/** A draft written by the seed, with the ids of its microchanges in the order they were added. */
export interface SeedDraft {
  author: User;
  proposalId: string;
  changeIds: string[];
}

/**
 * Drives the editorial flow through its services, as the API does: a draft
 * with its sources and microchanges, then either a submission the seed's
 * moderator reviews or, when staff wrote it, a direct publication.
 */
export class EditorialSeeder {
  private readonly entities: EditorialEntitiesService;
  private readonly proposals: ProposalsService;
  private readonly changes: ProposalChangesService;
  private readonly sources: ProposalSourcesService;
  private readonly decisions: DecisionsService;

  constructor(
    app: INestApplicationContext,
    private readonly moderator: User,
  ) {
    this.entities = app.get(EditorialEntitiesService);
    this.proposals = app.get(ProposalsService);
    this.changes = app.get(ProposalChangesService);
    this.sources = app.get(ProposalSourcesService);
    this.decisions = app.get(DecisionsService);
  }

  /** Reserves a root for a creation in the author's name. */
  async reserve(author: User, entityType: EditorialEntityType): Promise<string> {
    return (await this.entities.reserve(author, entityType)).id;
  }

  /**
   * Writes a draft and gets it applied: staff publish their own directly; any
   * other author submits it and the moderator applies each microchange in the
   * order the author added them, so prerequisites apply first.
   */
  async propose(proposal: SeedProposal): Promise<void> {
    const draft = await this.draft(proposal);
    if (isStaff(proposal.author)) {
      await this.publish(draft);
      return;
    }
    await this.submit(draft);
    for (const changeId of draft.changeIds) await this.decide(this.moderator, changeId, { action: 'apply' });
  }

  /** Writes a draft with its sources and microchanges, resolving the insertions its target keys name. */
  async draft({ author, description, sources, changes }: SeedProposal): Promise<SeedDraft> {
    const proposal = await this.proposals.create(author, { description });
    for (const url of sources) await this.sources.add(author, proposal.id, { url });
    const insertions = new Map<string, string>();
    const changeIds: string[] = [];
    for (const change of changes) {
      const added = await this.changes.add(author, proposal.id, {
        entityId: change.entityId,
        operation: change.operation,
        targetPath: change.targetPath,
        targetKey: change.targetKey && resolveInsertions(change.targetKey, insertions),
        proposedValue: change.value === undefined ? { exists: false } : { exists: true, value: change.value },
      });
      if (change.label) insertions.set(change.label, added.id);
      changeIds.push(added.id);
    }
    return { author, proposalId: proposal.id, changeIds };
  }

  /** Sends a draft to review. */
  async submit({ author, proposalId }: SeedDraft): Promise<void> {
    await this.proposals.submit(author, proposalId);
  }

  /** Publishes a draft of staff directly. */
  async publish({ author, proposalId }: SeedDraft): Promise<void> {
    await this.decisions.publish(author, proposalId);
  }

  /** Decides a microchange as `actor`: the moderator by default, or its author withdrawing it. */
  async decide(actor: User, changeId: string, input: DecisionInput): Promise<void> {
    await this.decisions.decide(actor, changeId, input);
  }
}

function resolveInsertions(targetKey: Record<string, unknown>, insertions: Map<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(targetKey).map(([name, member]) => {
      const label = (member as Partial<InsertionReference> | null)?.insertion;
      if (label === undefined) return [name, member];
      const changeId = insertions.get(label);
      if (!changeId) throw new Error(`The seed names the insertion "${label}" before adding it`);
      return [name, { change_id: changeId }];
    }),
  );
}
