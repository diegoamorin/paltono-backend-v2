import { HttpStatus, Injectable, applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsIn, IsOptional } from 'class-validator';
import { DataSource, EntityManager, In } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { collectionQuery, requireOneOf } from '../common/json-api/query';
import { defineResource } from '../common/json-api/resource-schema';
import {
  CONTRIBUTION_ROLE_CATEGORIES,
  CONTRIBUTION_ROLE_SCOPES,
  ContributionRole,
  ContributionRoleCategory,
  ContributionRoleScope,
  ContributionRoleScopeName,
} from './entities/contribution-role.entity';
import {
  DESCRIPTION_MAX_LENGTH,
  DescriptionValidation,
  IfPresent,
  IfPresentAndNotNull,
  NAME_MAX_LENGTH,
  NameValidation,
  SLUG_MAX_LENGTH,
  SlugValidation,
  requestDocument,
  responseResource,
} from './vocabulary-documents';
import { Vocabulary, VocabularyStore, containsFilter, equalsFilter, isInUseViolation } from './vocabulary-store';
import { vocabularyController } from './vocabulary.controller';

/** The scopes of a role, in their declared order. */
function scopesOf(role: ContributionRole): ContributionRoleScopeName[] {
  const allowed = new Set((role.allowedScopes ?? []).map(({ scope }) => scope));
  return CONTRIBUTION_ROLE_SCOPES.filter((scope) => allowed.has(scope));
}

const schema = defineResource<ContributionRole>({
  type: 'contribution-roles',
  id: (role) => String(role.id),
  attributes: {
    slug: (role) => role.slug,
    name: (role) => role.name,
    description: (role) => role.description,
    category: (role) => role.category,
    scopes: scopesOf,
  },
});

export const CONTRIBUTION_ROLES: Vocabulary<ContributionRole> = {
  type: 'contribution-roles',
  entity: ContributionRole,
  schema,
  query: collectionQuery(schema, {
    sort: ['name', 'category'],
    defaultSort: 'name',
    filters: ['q', 'slug', 'category', 'scope'],
  }),
  filters: {
    q: containsFilter('name'),
    slug: equalsFilter('slug'),
    category: (builder, value) => {
      requireOneOf('filter[category]', value, CONTRIBUTION_ROLE_CATEGORIES);
      equalsFilter('category')(builder, value);
    },
    // A subquery rather than a condition on the joined scopes, so matching roles still list all of theirs.
    scope: (builder, value) => {
      requireOneOf('filter[scope]', value, CONTRIBUTION_ROLE_SCOPES);
      builder.andWhere(
        'EXISTS (SELECT 1 FROM contribution_role_scopes s WHERE s.contribution_role_id = entry.id AND s.scope = :scope)',
        { scope: value },
      );
    },
  },
  uniqueAttributes: { contribution_roles_slug_key: 'slug' },
  relations: ['allowedScopes'],
};

const ScopesValidation = () =>
  applyDecorators(IsArray(), ArrayNotEmpty(), ArrayUnique(), IsIn(CONTRIBUTION_ROLE_SCOPES, { each: true }));

class ContributionRoleAttributes {
  @ApiProperty({ example: 'composer', maxLength: SLUG_MAX_LENGTH })
  @SlugValidation()
  slug: string;

  @ApiProperty({ example: 'Composición', maxLength: NAME_MAX_LENGTH })
  @NameValidation()
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @DescriptionValidation()
  description?: string | null;

  @ApiProperty({ enum: CONTRIBUTION_ROLE_CATEGORIES })
  @IsIn(CONTRIBUTION_ROLE_CATEGORIES)
  category: ContributionRoleCategory;

  @ApiProperty({ enum: CONTRIBUTION_ROLE_SCOPES, isArray: true, description: 'Ámbitos donde se puede acreditar' })
  @ScopesValidation()
  scopes: ContributionRoleScopeName[];
}

class ContributionRoleChanges {
  @ApiPropertyOptional({ maxLength: SLUG_MAX_LENGTH })
  @IfPresent()
  @SlugValidation()
  slug?: string;

  @ApiPropertyOptional({ maxLength: NAME_MAX_LENGTH })
  @IfPresent()
  @NameValidation()
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: DESCRIPTION_MAX_LENGTH, description: 'null la borra' })
  @IfPresentAndNotNull()
  @DescriptionValidation()
  description?: string | null;

  @ApiPropertyOptional({ enum: CONTRIBUTION_ROLE_CATEGORIES })
  @IfPresent()
  @IsIn(CONTRIBUTION_ROLE_CATEGORIES)
  category?: ContributionRoleCategory;

  @ApiPropertyOptional({
    enum: CONTRIBUTION_ROLE_SCOPES,
    isArray: true,
    description: 'Sustituye el conjunto completo; quitar un ámbito en uso responde 409',
  })
  @IfPresent()
  @ScopesValidation()
  scopes?: ContributionRoleScopeName[];
}

class ContributionRoleResponseAttributes {
  @ApiProperty({ example: 'composer' })
  slug: string;

  @ApiProperty({ example: 'Composición' })
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ enum: CONTRIBUTION_ROLE_CATEGORIES })
  category: string;

  @ApiProperty({ enum: CONTRIBUTION_ROLE_SCOPES, isArray: true })
  scopes: string[];
}

type ContributionRoleWrite = Partial<ContributionRole> & { scopes?: ContributionRoleScopeName[] };

/** Manages a role's scopes as a set alongside the role itself. */
@Injectable()
export class ContributionRolesStore extends VocabularyStore<ContributionRole> {
  constructor(dataSource: DataSource, clock: Clock) {
    super(CONTRIBUTION_ROLES, dataSource, clock);
  }

  protected async afterWrite(manager: EntityManager, role: ContributionRole, attributes: ContributionRoleWrite): Promise<void> {
    if (!attributes.scopes) return;
    const wanted = new Set(attributes.scopes);
    const current = (await manager.findBy(ContributionRoleScope, { contributionRoleId: role.id })).map(({ scope }) => scope);

    const removed = current.filter((scope) => !wanted.has(scope));
    if (removed.length > 0) {
      try {
        await manager.delete(ContributionRoleScope, { contributionRoleId: role.id, scope: In(removed) });
      } catch (error) {
        if (!isInUseViolation(error)) throw error;
        throw new JsonApiException(HttpStatus.CONFLICT, [
          { code: 'scope_in_use', detail: 'A removed scope is in use by the catalog', source: { pointer: '/data/attributes/scopes' } },
        ]);
      }
    }
    const added = [...wanted].filter((scope) => !current.includes(scope));
    if (added.length > 0) {
      await manager.insert(
        ContributionRoleScope,
        added.map((scope) => ({ contributionRoleId: role.id, scope })),
      );
    }
  }

  protected async beforeRemove(manager: EntityManager, role: ContributionRole): Promise<void> {
    await manager.delete(ContributionRoleScope, { contributionRoleId: role.id });
  }
}

export const ContributionRolesController = vocabularyController({
  vocabulary: CONTRIBUTION_ROLES,
  store: ContributionRolesStore,
  resource: responseResource('ContributionRoleResource', 'contribution-roles', ContributionRoleResponseAttributes),
  createDocument: requestDocument('ContributionRoleCreate', 'contribution-roles', ContributionRoleAttributes),
  updateDocument: requestDocument('ContributionRoleUpdate', 'contribution-roles', ContributionRoleChanges, { withId: true }),
  singular: 'rol musical',
  plural: 'roles musicales',
  updateNotes: 'scopes se gestiona como conjunto: quitar un ámbito en uso responde 409.',
});
