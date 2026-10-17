import { Body, Controller, Get, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsDefined, IsInt, IsNotEmpty, IsString, Min, ValidateNested } from 'class-validator';
import { Clock } from '../../src/common/clock/clock';
import { collectionDocument, pageWindow, resourceDocument } from '../../src/common/json-api/document';
import { JsonApiQuery } from '../../src/common/json-api/json-api-query.decorator';
import { CollectionQuery, ResourceQuery, collectionQuery, resourceQuery } from '../../src/common/json-api/query';
import { defineResource } from '../../src/common/json-api/resource-schema';
import {
  ApiJsonApiBody,
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
  ResourceIdentifier,
} from '../../src/common/json-api/swagger';

/*
 * A resource that exists only in tests, to exercise the shared JSON:API
 * infrastructure before the first real resource: 45 widgets, each made by one
 * of three makers (which belong to a country) and carrying two tags.
 */

interface Country {
  code: string;
  name: string;
}

interface Maker {
  id: number;
  name: string;
  country: Country;
}

interface Tag {
  slug: string;
}

interface Widget {
  id: number;
  name: string;
  price: number;
  createdAt: Date;
  maker: Maker;
  tags: Tag[];
}

const NEW_FOR_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const korea: Country = { code: 'KR', name: 'Corea del Sur' };
const makers: Maker[] = [
  { id: 1, name: 'Hybe Merch', country: korea },
  { id: 2, name: 'SM Goods', country: korea },
  { id: 3, name: 'Weverse Shop US', country: { code: 'US', name: 'Estados Unidos' } },
];
const tags: Tag[] = [{ slug: 'limited' }, { slug: 'official' }];

const widgets: Widget[] = Array.from({ length: 45 }, (_, index) => {
  const id = index + 1;
  return {
    id,
    name: ['Lightstick', 'Photocard', 'Poster'][id % 3],
    // Odd ids are priced 27–49 and even ids 1–22, so every price is distinct.
    price: id % 2 === 1 ? (id + 53) / 2 : id / 2,
    createdAt: new Date(Date.UTC(2026, 0, 1) + id * DAY),
    maker: makers[id % 3],
    tags,
  };
});

const countrySchema = defineResource<Country>({
  type: 'countries',
  id: (country) => country.code,
  attributes: { name: (country) => country.name },
});

const makerSchema = defineResource<Maker>({
  type: 'makers',
  id: (maker) => String(maker.id),
  attributes: { name: (maker) => maker.name },
  relationships: { country: { schema: () => countrySchema, get: (maker) => maker.country } },
});

const tagSchema = defineResource<Tag>({
  type: 'tags',
  id: (tag) => tag.slug,
  attributes: {},
});

function widgetSchema(clock: Clock) {
  return defineResource<Widget>({
    type: 'widgets',
    id: (widget) => String(widget.id),
    attributes: {
      name: (widget) => widget.name,
      price: (widget) => widget.price,
      createdAt: (widget) => widget.createdAt.toISOString(),
      isNew: (widget) => clock.now().getTime() - widget.createdAt.getTime() < NEW_FOR_DAYS * DAY,
    },
    relationships: {
      maker: { schema: () => makerSchema, get: (widget) => widget.maker },
      tags: { schema: () => tagSchema, get: (widget) => widget.tags },
    },
  });
}

// Query specs only need names, so they can be declared from a schema built with any clock.
const schemaShape = widgetSchema({ now: () => new Date() });
const WIDGETS_QUERY = collectionQuery(schemaShape, {
  sort: ['name', 'price', 'createdAt'],
  defaultSort: '-createdAt',
  filters: ['name'],
  include: ['maker.country', 'tags'],
});
const WIDGET_QUERY = resourceQuery(schemaShape, { include: ['maker.country', 'tags'] });

const sortValue: Record<string, (widget: Widget) => string | number> = {
  id: (widget) => widget.id,
  name: (widget) => widget.name,
  price: (widget) => widget.price,
  createdAt: (widget) => widget.createdAt.getTime(),
};

class WidgetAttributes {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  price: number;
}

class WidgetResource {
  @ApiProperty({ enum: ['widgets'] })
  @Equals('widgets')
  type: string;

  @ApiProperty({ type: WidgetAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => WidgetAttributes)
  attributes: WidgetAttributes;
}

class CreateWidgetDocument {
  @ApiProperty({ type: WidgetResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => WidgetResource)
  data: WidgetResource;
}

class WidgetRelationship {
  @ApiProperty({ type: ResourceIdentifier })
  data: ResourceIdentifier;
}

class WidgetRelationships {
  @ApiProperty({ type: WidgetRelationship })
  maker: WidgetRelationship;
}

class WidgetResourceObject extends WidgetResource {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: WidgetRelationships })
  relationships: WidgetRelationships;
}

@ApiTags('widgets')
@Controller('widgets')
class WidgetsController {
  private readonly schema: ReturnType<typeof widgetSchema>;

  constructor(clock: Clock) {
    this.schema = widgetSchema(clock);
  }

  @Get()
  @ApiOperation({ summary: 'Listar widgets' })
  @ApiJsonApiQuery(WIDGETS_QUERY)
  @ApiJsonApiCollectionResponse(WidgetResourceObject)
  @ApiJsonApiErrorResponses(400, 406)
  list(@JsonApiQuery(WIDGETS_QUERY) query: CollectionQuery) {
    const matching = widgets.filter((widget) => !query.filter.name || widget.name === query.filter.name);
    const sorted = [...matching].sort((a, b) => {
      for (const { field, direction } of query.sort) {
        const [left, right] = [sortValue[field](a), sortValue[field](b)];
        if (left !== right) return (left < right ? -1 : 1) * (direction === 'ASC' ? 1 : -1);
      }
      return 0;
    });
    const { skip, take } = pageWindow(query);
    return collectionDocument(this.schema, sorted.slice(skip, skip + take), matching.length, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver un widget' })
  @ApiJsonApiQuery(WIDGET_QUERY)
  @ApiJsonApiResourceResponse(WidgetResourceObject)
  @ApiJsonApiErrorResponses(400, 404, 406)
  show(@Param('id') id: string, @JsonApiQuery(WIDGET_QUERY) query: ResourceQuery) {
    if (id === 'explode') throw new Error('database password is hunter2');
    const widget = widgets.find((each) => String(each.id) === id);
    if (!widget) throw new NotFoundException(`Widget ${id} does not exist`);
    return resourceDocument(this.schema, widget, query);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un widget' })
  @ApiJsonApiBody(CreateWidgetDocument)
  @ApiJsonApiResourceResponse(WidgetResourceObject, 201)
  @ApiJsonApiErrorResponses(406, 415, 422)
  create(@Body() body: CreateWidgetDocument) {
    return { data: { type: 'widgets', id: '46', attributes: body.data.attributes } };
  }
}

@Module({ controllers: [WidgetsController] })
export class WidgetsFixtureModule {}
