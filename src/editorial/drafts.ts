import { HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { lockContributor, proposalNotFound } from './editorial-access';
import { ChangeProposal } from './entities/change-proposal.entity';

/*
 * Every write to a draft (its description, microchanges and sources, its
 * discarding and its submission) starts here, inside the write's transaction:
 * first the author's account, then the proposal row. Taking both locks in that
 * order everywhere serializes the writes to one draft, so a submission never
 * freezes a half-made edit and two submissions cannot both succeed.
 */

/** Locks a draft for a write by its author; anyone else gets the given not-found error. */
export async function lockOwnDraft(
  manager: EntityManager,
  user: User,
  proposalId: string,
  notFound: () => JsonApiException = proposalNotFound,
): Promise<ChangeProposal> {
  const author = await lockContributor(manager, user.id);
  const proposal = await manager.findOne(ChangeProposal, { where: { id: proposalId }, lock: { mode: 'pessimistic_write' } });
  // A draft is hidden from everyone else; a submission is public, so only its author's permission is missing.
  if (!proposal || (proposal.status === 'draft' && proposal.authorId !== author.id)) throw notFound();
  if (proposal.authorId !== author.id) {
    throw new JsonApiException(HttpStatus.FORBIDDEN, [{ code: 'not_proposal_author', detail: 'Only the author can change a proposal' }]);
  }
  if (proposal.status !== 'draft') {
    throw new JsonApiException(HttpStatus.CONFLICT, [
      { code: 'proposal_submitted', detail: 'The proposal is submitted; its content is frozen. Correct it with a new proposal' },
    ]);
  }
  return proposal;
}

/** Records an edit of a draft's content. */
export async function touchDraft(manager: EntityManager, proposal: ChangeProposal, now: Date): Promise<void> {
  await manager.update(ChangeProposal, { id: proposal.id }, { updatedAt: now });
}
