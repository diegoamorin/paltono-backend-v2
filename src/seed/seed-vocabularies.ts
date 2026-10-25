import { INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ContributionRolesStore } from '../vocabularies/contribution-roles';
import { loadCountries } from '../vocabularies/country-list';
import { ContributionRoleCategory, ContributionRoleScopeName } from '../vocabularies/entities/contribution-role.entity';
import { GenresStore } from '../vocabularies/genres';
import { OrganizationTypesStore } from '../vocabularies/organization-types';
import { PlatformsStore } from '../vocabularies/platforms';

/*
 * The shared vocabularies the seed's catalog refers to. They are administered
 * data, written as an administrator would and outside the editorial flow; the
 * countries come from the whole country list, as `pnpm countries:load` loads it.
 */

/** The countries the catalog refers to, among all those `loadCountries` inserts. */
const COUNTRIES = ['KR', 'JP', 'CN', 'TW', 'TH', 'AU', 'NZ', 'US', 'CA', 'GB', 'IT'] as const;
export type CountryCode = (typeof COUNTRIES)[number];

const GENRES = {
  'k-pop': 'K-pop',
  pop: 'Pop',
  'dance-pop': 'Dance pop',
  disco: 'Disco',
  'disco-pop': 'Disco pop',
  electropop: 'Electropop',
  edm: 'Música electrónica de baile',
  'hip-hop': 'Hip hop',
  trap: 'Trap',
} as const;
export type GenreSlug = keyof typeof GENRES;

const ORGANIZATION_TYPES = {
  agency: { name: 'Agencia', description: 'Empresa que gestiona la carrera de sus artistas' },
  label: { name: 'Sello discográfico', description: 'Empresa que publica grabaciones' },
  group: { name: 'Grupo musical', description: 'Grupo de artistas que actúa bajo un nombre común' },
  subunit: { name: 'Subunidad', description: 'Grupo formado por parte de los miembros de otro grupo' },
  'production-team': { name: 'Equipo de producción', description: 'Equipo que compone y produce para otros artistas' },
  promoter: { name: 'Promotora de conciertos', description: 'Empresa que organiza y promociona conciertos y tours' },
} as const;
export type OrganizationTypeSlug = keyof typeof ORGANIZATION_TYPES;

export type RoleSlug = 'songwriter' | 'lyricist' | 'composer' | 'producer' | 'leader' | 'vocalist' | 'rapper' | 'dancer' | 'drummer';

const ROLES: Record<RoleSlug, { name: string; category: ContributionRoleCategory; scopes: ContributionRoleScopeName[] }> = {
  songwriter: { name: 'Autoría', category: 'writing', scopes: ['work'] },
  lyricist: { name: 'Letra', category: 'writing', scopes: ['work'] },
  composer: { name: 'Composición', category: 'writing', scopes: ['work'] },
  producer: { name: 'Producción', category: 'production', scopes: ['recording', 'release'] },
  leader: { name: 'Líder', category: 'performance', scopes: ['membership'] },
  vocalist: { name: 'Voz', category: 'performance', scopes: ['recording', 'membership'] },
  rapper: { name: 'Rap', category: 'performance', scopes: ['recording', 'membership'] },
  dancer: { name: 'Baile', category: 'performance', scopes: ['membership'] },
  drummer: { name: 'Batería', category: 'performance', scopes: ['recording', 'membership'] },
};

const PLATFORMS = {
  youtube: {
    name: 'YouTube',
    iconUrl: 'https://www.youtube.com/favicon.ico',
    supportsCatalogIdentity: true,
    supportsTrack: true,
    supportsAlbum: true,
  },
  spotify: {
    name: 'Spotify',
    iconUrl: 'https://open.spotify.com/favicon.ico',
    supportsCatalogIdentity: true,
    supportsTrack: true,
    supportsAlbum: true,
  },
} as const;
export type PlatformSlug = keyof typeof PLATFORMS;

/** The id of each seeded vocabulary entry, by its code or slug. */
export interface SeedVocabularies {
  countries: Record<CountryCode, number>;
  genres: Record<GenreSlug, number>;
  organizationTypes: Record<OrganizationTypeSlug, number>;
  roles: Record<RoleSlug, number>;
  platforms: Record<PlatformSlug, number>;
}

export async function seedVocabularies(app: INestApplicationContext): Promise<SeedVocabularies> {
  const ids = async <K extends string>(entries: Record<K, unknown>, create: (key: K) => Promise<{ id: number }>) => {
    const result = {} as Record<K, number>;
    for (const key of Object.keys(entries) as K[]) result[key] = (await create(key)).id;
    return result;
  };
  const dataSource = app.get(DataSource);
  await loadCountries(dataSource);
  const countryRows: { id: number; code: CountryCode }[] = await dataSource.query('SELECT id, code FROM countries WHERE code = ANY($1)', [COUNTRIES]);
  const genres = app.get(GenresStore);
  const organizationTypes = app.get(OrganizationTypesStore);
  const roles = app.get(ContributionRolesStore);
  const platforms = app.get(PlatformsStore);

  return {
    countries: Object.fromEntries(countryRows.map(({ id, code }) => [code, id])) as Record<CountryCode, number>,
    genres: await ids(GENRES, (slug) => genres.create({ slug, name: GENRES[slug] })),
    organizationTypes: await ids(ORGANIZATION_TYPES, (slug) => organizationTypes.create({ slug, ...ORGANIZATION_TYPES[slug] })),
    // The store takes the scopes alongside the role's own columns.
    roles: await ids(ROLES, (slug) => roles.create({ slug, ...ROLES[slug] } as never)),
    platforms: await ids(PLATFORMS, (slug) => platforms.create({ slug, ...PLATFORMS[slug] })),
  };
}
