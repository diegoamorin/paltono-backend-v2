import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { Clock } from '../common/clock/clock';
import { invalid, sourceNotFound } from './editorial-access';
import { lockOwnDraft, touchDraft } from './drafts';
import { ChangeSource } from './entities/proposal-links.entity';
import { ProposalSource } from './entities/proposal-source.entity';

export interface SourceInput {
  /** `null` clears it; `undefined` keeps it. */
  url?: string | null;
  citationText?: string | null;
}

/** General sources of a draft: a web address, a bibliographic citation or both. */
@Injectable()
export class ProposalSourcesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  add(user: User, proposalId: string, input: SourceInput): Promise<ProposalSource> {
    return this.dataSource.transaction(async (manager) => {
      const proposal = await lockOwnDraft(manager, user, proposalId);
      const source = { url: input.url ?? null, citationText: input.citationText ?? null };
      requireReference(source);
      const now = this.clock.now();
      const id = randomUUID();
      await manager.insert(ProposalSource, { id, proposalId, ...source, createdAt: now });
      await touchDraft(manager, proposal, now);
      return manager.findOneByOrFail(ProposalSource, { id });
    });
  }

  update(user: User, proposalId: string, sourceId: string, input: SourceInput): Promise<ProposalSource> {
    return this.dataSource.transaction(async (manager) => {
      const proposal = await lockOwnDraft(manager, user, proposalId);
      const current = await findSource(manager, proposalId, sourceId);
      const source = {
        url: input.url === undefined ? current.url : input.url,
        citationText: input.citationText === undefined ? current.citationText : input.citationText,
      };
      requireReference(source);
      await manager.update(ProposalSource, { id: sourceId }, source);
      await touchDraft(manager, proposal, this.clock.now());
      return manager.findOneByOrFail(ProposalSource, { id: sourceId });
    });
  }

  remove(user: User, proposalId: string, sourceId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const proposal = await lockOwnDraft(manager, user, proposalId);
      await findSource(manager, proposalId, sourceId);
      await manager.delete(ChangeSource, { sourceId });
      await manager.delete(ProposalSource, { id: sourceId });
      await touchDraft(manager, proposal, this.clock.now());
    });
  }
}

function requireReference(source: Required<SourceInput>): void {
  if (source.url === null && source.citationText === null) {
    throw invalid([
      { code: 'source_reference_required', detail: 'A source needs a URL, a citation or both', source: { pointer: '/data/attributes' } },
    ]);
  }
}

async function findSource(manager: EntityManager, proposalId: string, sourceId: string): Promise<ProposalSource> {
  const source = await manager.findOneBy(ProposalSource, { id: sourceId, proposalId });
  if (!source) throw sourceNotFound();
  return source;
}
