import { ApiProperty } from '@nestjs/swagger';
import type { ArtistEntry } from '../catalog-identities/artist.resource';
import { IdentityEntry, identitySchema } from '../catalog-identities/identity.resource';
import { ResourceIdentifier } from '../common/json-api/swagger';
import { CONTRIBUTION_ROLES } from '../vocabularies/contribution-roles';
import { ContributionRole } from '../vocabularies/entities/contribution-role.entity';
import { Credit } from './entities/work.entity';
import type { RecordingEntry, WorkEntry } from './music.resource';
import type { EditionEntry } from './release.resource';

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

/**
 * The name an artist credit shows: its credited name or, without one, the
 * display name of the artist's identity, which a withdrawn identity does not show.
 */
export const creditedName = (creditedAs: string | null, { identity }: ArtistEntry): string | null =>
  creditedAs ?? (identity.identity.editorialEntity!.publicationStatus === 'withdrawn' ? null : identity.identity.displayName);

export type CreditScope = 'work' | 'recording' | 'edition';

export interface CreditEntry {
  scope: CreditScope;
  credit: Credit;
  identity: IdentityEntry;
  /** With its scopes. */
  role: ContributionRole;
  /** The credited work, recording or edition, loaded where the credit is the primary data. */
  work?: WorkEntry;
  recording?: RecordingEntry;
  edition?: EditionEntry;
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
