import { INestApplicationContext } from '@nestjs/common';
import { User } from '../accounts/entities/user.entity';
import { DecisionsService } from '../editorial/decisions.service';
import { isStaff } from '../editorial/editorial-access';
import { EditorialEntitiesService } from '../editorial/editorial-entities.service';
import { EditorialEntityType } from '../editorial/entities/editorial-entity.entity';
import { ProposalChangesService } from '../editorial/proposal-changes.service';
import { ProposalSourcesService } from '../editorial/proposal-sources.service';
import { ProposalsService } from '../editorial/proposals.service';

/** A microchange as a draft adds it: absence when `value` is undefined. */
export interface SeedChange {
  entityId: string;
  operation: 'create_entity' | 'set_fields' | 'add_relation';
  targetPath: string;
  targetKey?: object;
  value?: unknown;
}

/** What a proposal of the seed says and who sends it. */
export interface SeedProposal {
  author: User;
  description: string;
  /** URLs of the general sources. */
  sources: string[];
  changes: SeedChange[];
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
  async propose({ author, description, sources, changes }: SeedProposal): Promise<void> {
    const proposal = await this.proposals.create(author, { description });
    for (const url of sources) await this.sources.add(author, proposal.id, { url });
    const changeIds: string[] = [];
    for (const change of changes) {
      const added = await this.changes.add(author, proposal.id, {
        entityId: change.entityId,
        operation: change.operation,
        targetPath: change.targetPath,
        targetKey: change.targetKey,
        proposedValue: change.value === undefined ? { exists: false } : { exists: true, value: change.value },
      });
      changeIds.push(added.id);
    }

    if (isStaff(author)) {
      await this.decisions.publish(author, proposal.id);
      return;
    }
    await this.proposals.submit(author, proposal.id);
    for (const changeId of changeIds) await this.decisions.decide(this.moderator, changeId, { action: 'apply' });
  }
}
