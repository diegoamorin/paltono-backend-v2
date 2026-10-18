import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { collectionDocument, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, ResourceQuery, collectionQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { IdentitiesService } from './identities.service';
import { IdentityResource, identitySchema } from './identity.resource';
import { MembershipResource, membershipSchema } from './membership.resource';

const INCLUDE = ['aliases', 'nationalities', 'originCountry', 'organizationTypes', 'platformLinks', 'platformLinks.platform', 'artist'];

const IDENTITY_QUERY = resourceQuery(identitySchema, { include: INCLUDE });

const IDENTITIES_QUERY = collectionQuery(identitySchema, {
  include: INCLUDE,
  sort: ['displayName', 'createdAt'],
  defaultSort: 'displayName',
  filters: ['q', 'type', 'hasArtistProfile', 'nationality', 'originCountry', 'organizationType'],
});

const MEMBERSHIPS_QUERY = collectionQuery(membershipSchema, {
  include: ['organization', 'member', 'roles', 'roles.role'],
  sort: ['joined', 'createdAt'],
  defaultSort: 'joined',
  filters: ['side'],
});

@ApiTags('catalog-identities')
@Controller('identities')
export class IdentitiesController {
  constructor(private readonly identities: IdentitiesService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar identidades',
    description:
      'Personas y organizaciones publicadas; una ficha retirada solo se consulta por su id. `filter[q]` busca en el nombre visible ' +
      'y los alias, sin distinguir mayúsculas ni acentos; `filter[type]` admite `person` y `organization`; `filter[hasArtistProfile]`, ' +
      '`true` o `false`; `filter[nationality]` y `filter[originCountry]` toman el código de dos letras de un país, y ' +
      '`filter[organizationType]`, el slug de un tipo de organización. Orden `displayName` (por defecto) o `-createdAt`.',
  })
  @ApiJsonApiQuery(IDENTITIES_QUERY)
  @ApiJsonApiCollectionResponse(IdentityResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@JsonApiQuery(IDENTITIES_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.identities.list(query);
    return collectionDocument(identitySchema, entries, total, query);
  }

  @Get(':id/memberships')
  @ApiOperation({
    summary: 'Listar las membresías de una identidad',
    description:
      'Membresías de la identidad como organización (`filter[side]=organization`: sus miembros) o como miembro ' +
      '(`filter[side]=member`: las organizaciones a las que pertenece); sin el filtro, ambas. Cada una con sus roles por posición. ' +
      'Un miembro retirado solo muestra su aviso; las membresías de una organización retirada forman parte de su contenido y no se listan. ' +
      'Orden `joined` (por defecto, fechas desconocidas al final) o `-createdAt`.',
  })
  @ApiParam({ name: 'id', description: 'public_id de la identidad' })
  @ApiJsonApiQuery(MEMBERSHIPS_QUERY)
  @ApiJsonApiCollectionResponse(MembershipResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async memberships(@Param('id') id: string, @JsonApiQuery(MEMBERSHIPS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.identities.memberships(id, query);
    return collectionDocument(membershipSchema, entries, total, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver una identidad',
    description:
      'Datos comunes, el subtipo `person` u `organization` y sus relaciones: alias, nacionalidades, país de origen, tipos de ' +
      'organización, enlaces a plataformas y perfil artístico. `meta.editorialEntityId` es su UUID editorial, para proponer cambios. ' +
      'Una reserva todavía no publicada no existe: responde 404. Una ficha retirada solo muestra su aviso, sin relaciones.',
  })
  @ApiParam({ name: 'id', description: 'public_id de la identidad' })
  @ApiJsonApiQuery(IDENTITY_QUERY)
  @ApiJsonApiResourceResponse(IdentityResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(IDENTITY_QUERY) query: ResourceQuery) {
    return resourceDocument(identitySchema, await this.identities.show(id), query);
  }
}
