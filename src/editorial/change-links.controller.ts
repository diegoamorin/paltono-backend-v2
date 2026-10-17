import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentAuthentication } from '../accounts/authenticated.decorator';
import { Authentication } from '../accounts/sessions.service';
import { relationshipDocument } from '../common/json-api/document';
import { ApiJsonApiBody, ApiJsonApiErrorResponses, ApiJsonApiRelationshipResponse } from '../common/json-api/swagger';
import { ChangeLinksService } from './change-links.service';
import { ChangeSourcesDocument, DependenciesDocument } from './dto/change-links.dto';
import { changeNotFound, editorialId } from './editorial-access';

const DEPENDENCIES_DESCRIPTION =
  'Solo microcambios del mismo borrador, de su autor. Se rechazan la autorreferencia y los ciclos, también los que aparecen al colapsar ' +
  'cada grupo atómico en un solo paso. Responde con todas las dependencias del microcambio. Un envío responde 409.';

@ApiTags('editorial')
@Controller('proposal-changes/:id/relationships')
export class ChangeLinksController {
  constructor(private readonly links: ChangeLinksService) {}

  @Post('dependencies')
  @HttpCode(HttpStatus.OK)
  @Authenticated('verified')
  @ApiOperation({ summary: 'Declarar dependencias de un microcambio', description: DEPENDENCIES_DESCRIPTION })
  @ApiParam({ name: 'id', description: 'UUID del microcambio' })
  @ApiJsonApiBody(DependenciesDocument)
  @ApiJsonApiRelationshipResponse()
  @ApiJsonApiErrorResponses(404, 406, 409, 415, 422)
  async addDependencies(@CurrentAuthentication() { user }: Authentication, @Param('id') id: string, @Body() body: DependenciesDocument) {
    const changeId = editorialId(id, changeNotFound);
    const dependsOn = await this.links.addDependencies(user, changeId, identifiers(body));
    return relationshipDocument('proposal-changes', dependsOn, dependenciesPath(changeId));
  }

  @Delete('dependencies')
  @HttpCode(HttpStatus.OK)
  @Authenticated('verified')
  @ApiOperation({ summary: 'Quitar dependencias de un microcambio', description: 'Responde con las dependencias restantes. Un envío responde 409.' })
  @ApiParam({ name: 'id', description: 'UUID del microcambio' })
  @ApiJsonApiBody(DependenciesDocument)
  @ApiJsonApiRelationshipResponse()
  @ApiJsonApiErrorResponses(404, 406, 409, 415, 422)
  async removeDependencies(@CurrentAuthentication() { user }: Authentication, @Param('id') id: string, @Body() body: DependenciesDocument) {
    const changeId = editorialId(id, changeNotFound);
    const dependsOn = await this.links.removeDependencies(user, changeId, identifiers(body));
    return relationshipDocument('proposal-changes', dependsOn, dependenciesPath(changeId));
  }

  @Post('sources')
  @HttpCode(HttpStatus.OK)
  @Authenticated('verified')
  @ApiOperation({
    summary: 'Vincular fuentes a un microcambio',
    description:
      'Solo fuentes generales del mismo borrador; una fuente de otra propuesta responde 422. ' +
      'Responde con todas las fuentes vinculadas. Un envío responde 409.',
  })
  @ApiParam({ name: 'id', description: 'UUID del microcambio' })
  @ApiJsonApiBody(ChangeSourcesDocument)
  @ApiJsonApiRelationshipResponse()
  @ApiJsonApiErrorResponses(404, 406, 409, 415, 422)
  async addSources(@CurrentAuthentication() { user }: Authentication, @Param('id') id: string, @Body() body: ChangeSourcesDocument) {
    const changeId = editorialId(id, changeNotFound);
    const sourceIds = await this.links.addSources(user, changeId, identifiers(body));
    return relationshipDocument('proposal-sources', sourceIds, sourcesPath(changeId));
  }

  @Delete('sources')
  @HttpCode(HttpStatus.OK)
  @Authenticated('verified')
  @ApiOperation({ summary: 'Desvincular fuentes de un microcambio', description: 'Responde con las fuentes que siguen vinculadas. Un envío responde 409.' })
  @ApiParam({ name: 'id', description: 'UUID del microcambio' })
  @ApiJsonApiBody(ChangeSourcesDocument)
  @ApiJsonApiRelationshipResponse()
  @ApiJsonApiErrorResponses(404, 406, 409, 415, 422)
  async removeSources(@CurrentAuthentication() { user }: Authentication, @Param('id') id: string, @Body() body: ChangeSourcesDocument) {
    const changeId = editorialId(id, changeNotFound);
    const sourceIds = await this.links.removeSources(user, changeId, identifiers(body));
    return relationshipDocument('proposal-sources', sourceIds, sourcesPath(changeId));
  }
}

function identifiers(body: { data: { id: string }[] }): string[] {
  return [...new Set(body.data.map(({ id }) => id.toLowerCase()))];
}

const dependenciesPath = (changeId: string) => `/v1/proposal-changes/${changeId}/relationships/dependencies`;
const sourcesPath = (changeId: string) => `/v1/proposal-changes/${changeId}/relationships/sources`;
