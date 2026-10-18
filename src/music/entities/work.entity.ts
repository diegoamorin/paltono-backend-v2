import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { EditorialEntity } from '../../editorial/entities/editorial-entity.entity';
import { CatalogIdentity } from '../../catalog-identities/entities/catalog-identity.entity';
import { CONTRIBUTION_ROLE_SCOPES, ContributionRoleScope, ContributionRoleScopeName } from '../../vocabularies/entities/contribution-role.entity';

/*
 * The work editorial root's domain rows. Only an applied creation inserts a
 * work: a reservation has no row here.
 */

// Mirrors the CreateWorksAndRecordings migration, so `migration:generate` finds no drift.
@Entity('works')
@Unique('works_slug_key', ['slug'])
@Unique('works_iswc_key', ['iswc'])
@Unique('works_editorial_entity_id_key', ['editorialEntityId'])
@Check('works_title_nonblank', `btrim(title) <> ''`)
@Check('works_slug_format', `slug ~ '^[^\\s/?#A-Z]+$'`)
@Check('works_iswc_format', `iswc ~ '^T[0-9]{10}$'`)
export class Work {
  /** The public identifier of the work, as a decimal string. */
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: string;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'varchar', length: 320 })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Canonical ISWC: `T` and ten digits, the last a check digit. */
  @Column({ type: 'char', length: 11, nullable: true })
  iswc: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'editorial_entity_id', type: 'uuid' })
  editorialEntityId: string;

  @ManyToOne(() => EditorialEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'editorial_entity_id', foreignKeyConstraintName: 'works_editorial_entity_id_fkey' })
  editorialEntity?: EditorialEntity;
}

/** The columns every credit shares: who, in which role, and how the source credits it. */
export abstract class Credit {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'catalog_identity_id', type: 'integer' })
  catalogIdentityId: number;

  @Column({ name: 'contribution_role_id', type: 'integer' })
  contributionRoleId: number;

  /** NULL shows the identity's display name. */
  @Column({ name: 'credited_as', type: 'varchar', length: 200, nullable: true })
  creditedAs: string | null;

  /** An editorial order, not importance or a share. */
  @Column({ type: 'smallint', default: 0 })
  position: number;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  @Column({ name: 'source_text', type: 'text', nullable: true })
  sourceText: string | null;

  @Column({ name: 'source_url', type: 'text', nullable: true })
  sourceUrl: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** The constraints every credit table declares, under its own names. */
export const creditChecks = (table: string, scope: string) => [
  Check(`${table}_role_scope`, `role_scope = '${scope}'`),
  Check(`${table}_credited_as_nonblank`, `credited_as IS NULL OR btrim(credited_as) <> ''`),
  Check(`${table}_position_nonnegative`, `position >= 0`),
  Check(`${table}_source_url_format`, `source_url IS NULL OR source_url ~* '^https?://[^\\s]+$'`),
  Index(`${table}_role_idx`, ['contributionRoleId', 'roleScope']),
];

/** The foreign keys of a credit: its identity, and its role in the credit's scope. */
export const creditJoins = (table: string) => ({
  identity: [
    ManyToOne(() => CatalogIdentity, { onDelete: 'RESTRICT' }),
    JoinColumn({ name: 'catalog_identity_id', foreignKeyConstraintName: `${table}_catalog_identity_id_fkey` }),
  ],
  role: [
    ManyToOne(() => ContributionRoleScope, { onDelete: 'RESTRICT' }),
    JoinColumn([
      { name: 'contribution_role_id', referencedColumnName: 'contributionRoleId', foreignKeyConstraintName: `${table}_role_fkey` },
      { name: 'role_scope', referencedColumnName: 'scope', foreignKeyConstraintName: `${table}_role_fkey` },
    ]),
  ],
});

const workCreditJoins = creditJoins('work_contributions');

@Entity('work_contributions')
@Index('work_contributions_work_id_idx', ['workId'])
@Index('work_contributions_catalog_identity_id_idx', ['catalogIdentityId'])
@applyAll(creditChecks('work_contributions', 'work'))
export class WorkContribution extends Credit {
  @Column({ name: 'work_id', type: 'bigint' })
  workId: string;

  @Column({ name: 'role_scope', type: 'enum', enum: CONTRIBUTION_ROLE_SCOPES, enumName: 'contribution_role_scope', default: 'work' })
  roleScope: ContributionRoleScopeName;

  @ManyToOne(() => Work, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'work_id', foreignKeyConstraintName: 'work_contributions_work_id_fkey' })
  work?: Work;

  @applyAll(workCreditJoins.identity)
  identity?: CatalogIdentity;

  @applyAll(workCreditJoins.role)
  roleInScope?: ContributionRoleScope;
}

/** Applies several decorators as one. */
export function applyAll(decorators: ((...args: any[]) => void)[]) {
  return (...args: any[]) => decorators.forEach((decorator) => decorator(...args));
}
