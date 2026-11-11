import {
  ReleaseArtistCreditValue,
  deleteReleaseArtistCredit,
  findReleaseArtistCredit,
  writeReleaseArtistCredit,
} from '../music/releases';
import { artistCreditChanges, artistCreditValue } from './artist-credit-changes';
import { reference } from './identity-relation-changes';
import type { OperationDefinition } from './operation-registry';

/*
 * Artist credits of a release: the artists it is presented with, in order,
 * for all its editions. A credit is keyed by the release and the artist.
 */

export const RELEASE_CREDIT_CHANGES: OperationDefinition[] = artistCreditChanges({
  entityType: 'release',
  targetPath: 'release_artist_credits',
  ownerKey: { release_id: reference('entity_id', 'Raíz editorial del lanzamiento: la del microcambio') },
  value: artistCreditValue(),
  descriptions: {
    add: 'Presenta el lanzamiento con un artista, en una posición. Su clave es el lanzamiento y la identidad del artista.',
    update: 'Cambia la posición o el nombre acreditado de un artista del lanzamiento.',
    remove: 'Quita un artista del crédito de artista del lanzamiento; la revisión guarda sus valores anteriores.',
  },
  find: (manager, _root, key) => findReleaseArtistCredit(manager, key.release_id, key.artist_id),
  write: (manager, _root, key, value, now) => writeReleaseArtistCredit(manager, key.release_id, key.artist_id, value as ReleaseArtistCreditValue, now),
  remove: (manager, _root, key, now) => deleteReleaseArtistCredit(manager, key.release_id, key.artist_id, now),
});
