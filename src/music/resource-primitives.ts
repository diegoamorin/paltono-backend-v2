import { ApiProperty } from '@nestjs/swagger';
import { IdentityEntry, identitySchema } from '../catalog-identities/identity.resource';
import { ResourceIdentifier } from '../common/json-api/swagger';
import { CONTRIBUTION_ROLES } from '../vocabularies/contribution-roles';
import { ContributionRole } from '../vocabularies/entities/contribution-role.entity';
import { Credit } from './entities/work.entity';
import type { RecordingEntry, WorkEntry } from './music.resource';
import type { ReleaseEntry } from './release.resource';

/*
 * What the resources of the catalog's editorial entries share: the withdrawal
 * notice, partial dates, linkages and credits. It loads none of those
 * resources, so they can refer to each other in any load order.
 */

type Root = { editorialEntity?: { publicationStatus: string } };

export const isWithdrawn = (root: Root) => root.editorialEntity!.publicationStatus === 'withdrawn';

/** An attribute of an entry's content, which a withdrawn entry leaves out: it only shows the notice. */
export const content =
  <T>(root: (entry: T) => Root, read: (entry: T) => unknown) =>
  (entry: T): unknown =>
    isWithdrawn(root(entry)) ? undefined : read(entry);

export const partialDate = (year: number | null, month: number | null, day: number | null) => (year === null ? null : { year, month, day });

export type CreditScope = 'work' | 'recording' | 'release';

export interface CreditEntry {
  scope: CreditScope;
  credit: Credit;
  identity: IdentityEntry;
  /** With its scopes. */
  role: ContributionRole;
  /** The credited work or recording, loaded where the credit is the primary data. */
  work?: WorkEntry;
  recording?: RecordingEntry;
  release?: ReleaseEntry;
}

export const creditAttributes = {
  creditedAs: ({ credit }: CreditEntry) => credit.creditedAs,
  position: ({ credit }: CreditEntry) => credit.position,
  details: ({ credit }: CreditEntry) => credit.details,
  sourceText: ({ credit }: CreditEntry) => credit.sourceText,
  sourceUrl: ({ credit }: CreditEntry) => credit.sourceUrl,
};

export const creditRelationships = {
  identity: { schema: () => identitySchema, get: ({ identity }: CreditEntry) => identity },
  role: { schema: () => CONTRIBUTION_ROLES.schema, get: ({ role }: CreditEntry) => role },
};

// Swagger descriptions shared by the resource objects.

export const WITHDRAWN = 'Ausente en una ficha retirada';

export class PartialDate {
  @ApiProperty({ example: 2021 })
  year: number;

  @ApiProperty({ type: Number, nullable: true, example: 5 })
  month: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  day: number | null;
}

export class EntryMeta {
  @ApiProperty({ format: 'uuid', description: 'UUID editorial con el que se proponen cambios a la ficha' })
  editorialEntityId: string;
}

export class ToOneLinkage {
  @ApiProperty({ type: ResourceIdentifier, nullable: true })
  data: ResourceIdentifier | null;
}

export class ToManyLinkage {
  @ApiProperty({ type: [ResourceIdentifier] })
  data: ResourceIdentifier[];
}
