import { In } from 'typeorm';
import { SearchSource, inOrder, publishedRoot } from '../common/search/search-source';
import { artistSchema } from './artist.resource';
import { loadArtistEntries } from './artists.service';
import { Artist } from './entities/artist.entity';
import { CatalogIdentity } from './entities/catalog-identity.entity';
import { loadEntries } from './identities.service';
import { identitySchema } from './identity.resource';

/* What global search finds of identities and artist profiles: display names and aliases. */

const identityNames = (select: string, from: string) => `
  SELECT ${select} AS id, identity.display_name AS text FROM ${from}
  UNION ALL
  SELECT ${select} AS id, alias.alias AS text FROM ${from} JOIN catalog_identity_aliases alias ON alias.catalog_identity_id = identity.id`;

export const IDENTITY_SEARCH: SearchSource = {
  type: 'identities',
  schema: identitySchema,
  textsSql: identityNames('identity.id::text', `catalog_identities identity ${publishedRoot('identity')}`),
  load: async (manager, ids) => {
    const identities = await manager.find(CatalogIdentity, { where: { id: In(ids.map(Number)) }, relations: { editorialEntity: true } });
    return loadEntries(manager, inOrder(ids, identities, ({ id }) => id));
  },
};

/** An artist profile is found by the names of its identity. */
export const ARTIST_SEARCH: SearchSource = {
  type: 'artists',
  schema: artistSchema,
  textsSql: identityNames('artist.id::text', `artists artist JOIN catalog_identities identity ON identity.id = artist.catalog_identity_id ${publishedRoot('identity')}`),
  load: async (manager, ids) => {
    const artists = await manager.find(Artist, { where: { id: In(ids.map(Number)) }, relations: { identity: { editorialEntity: true } } });
    return loadArtistEntries(manager, inOrder(ids, artists, ({ id }) => id));
  },
};
