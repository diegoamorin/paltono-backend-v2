import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { collectionDocument, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, CollectionQueryOptions, ResourceQuery, collectionQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { TrackResource, trackSchema } from './track.resource';
import { TracksService } from './tracks.service';

const INCLUDE = ['recording', 'artistCredits', 'artistCredits.artist', 'platformLinks', 'platformLinks.platform'];

/** What lists of tracks accept, besides their filters. */
const TRACKS_OPTIONS: CollectionQueryOptions = { include: INCLUDE, sort: ['discNumber', 'trackNumber'], defaultSort: 'discNumber,trackNumber' };

const TRACK_QUERY = resourceQuery(trackSchema, { include: INCLUDE });
const TRACKS_QUERY = collectionQuery(trackSchema, TRACKS_OPTIONS);
const ARTIST_TRACKS_QUERY = collectionQuery(trackSchema, { ...TRACKS_OPTIONS, filters: ['rank'] });

const TRACK =
  '`displayTitle` muestra su título literal o, si no tiene, el título vigente de su grabación, sin copiarlo. `include` admite ' +
  '`recording`, `artistCredits`, `artistCredits.artist`, `platformLinks` y `platformLinks.platform`.';

/**
 * Tracks of the catalog (M6, M9, M10 and C9). A track has no editorial root:
 * it is shown while its release is published.
 */
@Controller()
export class TracksController {
  constructor(private readonly tracks: TracksService) {}

  @Get('tracks/:id')
  @ApiTags('music')
  @ApiOperation({
    summary: 'Ver una pista',
    description: `Disco, número y título de una pista, con su edición y su grabación. ${TRACK} Una pista de una edición retirada responde 404.`,
  })
  @ApiParam({ name: 'id', description: 'PK entera de la pista' })
  @ApiJsonApiQuery(TRACK_QUERY)
  @ApiJsonApiResourceResponse(TrackResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(TRACK_QUERY) query: ResourceQuery) {
    return resourceDocument(trackSchema, await this.tracks.show(id), query);
  }

  @Get('releases/:id/tracks')
  @ApiTags('music')
  @ApiOperation({
    summary: 'Pistas de una edición',
    description: `Tracklist de la edición, por disco y número. ${TRACK} Una edición retirada no muestra pistas.`,
  })
  @ApiParam({ name: 'id', description: 'public_id de la edición' })
  @ApiJsonApiQuery(TRACKS_QUERY)
  @ApiJsonApiCollectionResponse(TrackResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async ofRelease(@Param('id') id: string, @JsonApiQuery(TRACKS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.tracks.ofRelease(id, query);
    return collectionDocument(trackSchema, entries, total, query);
  }

  @Get('recordings/:id/tracks')
  @ApiTags('music')
  @ApiOperation({
    summary: 'Apariciones de una grabación',
    description: `Pistas de ediciones publicadas que usan la grabación, por disco y número. ${TRACK} Una grabación retirada no muestra apariciones.`,
  })
  @ApiParam({ name: 'id', description: 'public_id de la grabación' })
  @ApiJsonApiQuery(TRACKS_QUERY)
  @ApiJsonApiCollectionResponse(TrackResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async ofRecording(@Param('id') id: string, @JsonApiQuery(TRACKS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.tracks.ofRecording(id, query);
    return collectionDocument(trackSchema, entries, total, query);
  }

  @Get('artists/:id/tracks')
  @ApiTags('catalog-identities')
  @ApiOperation({
    summary: 'Pistas acreditadas a un artista',
    description:
      'Pistas de ediciones publicadas con crédito de presentación del artista, por disco y número. `filter[rank]` admite `main`, ' +
      `\`featured\` y \`remixer\`. ${TRACK} Un artista cuya identidad está retirada no muestra pistas.`,
  })
  @ApiParam({ name: 'id', description: 'public_id del perfil artístico' })
  @ApiJsonApiQuery(ARTIST_TRACKS_QUERY)
  @ApiJsonApiCollectionResponse(TrackResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async ofArtist(@Param('id') id: string, @JsonApiQuery(ARTIST_TRACKS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.tracks.ofArtist(id, query);
    return collectionDocument(trackSchema, entries, total, query);
  }
}
