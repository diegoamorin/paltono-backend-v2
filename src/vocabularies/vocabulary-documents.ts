import { Type as Class, applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Equals, IsDefined, IsNotEmpty, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { ResourceIdentifier } from '../common/json-api/swagger';

/*
 * Request and response documents shared by the vocabularies. Each vocabulary
 * declares its attribute classes; these helpers wrap them in the JSON:API
 * document shape, which is the same for all of them.
 */

export const NAME_MAX_LENGTH = 100;
export const SLUG_MAX_LENGTH = 64;
export const DESCRIPTION_MAX_LENGTH = 2000;

/** Lowercase ASCII words joined by single hyphens, such as `k-pop`. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const trim = Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** In an update, an omitted member keeps its value; `null` is still validated, so it is rejected. */
export const IfPresent = () => ValidateIf((_, value) => value !== undefined);

/** In an update, an omitted member keeps its value and `null` clears it. */
export const IfPresentAndNotNull = () => ValidateIf((_, value) => value !== undefined && value !== null);

export const NameValidation = () => applyDecorators(trim, IsString(), IsNotEmpty(), MaxLength(NAME_MAX_LENGTH));

export const SlugValidation = () =>
  applyDecorators(
    IsString(),
    MaxLength(SLUG_MAX_LENGTH),
    Matches(SLUG_PATTERN, { message: 'slug must be lowercase letters and digits separated by single hyphens' }),
  );

export const DescriptionValidation = () => applyDecorators(trim, IsString(), MaxLength(DESCRIPTION_MAX_LENGTH));

function named<T extends Class>(target: T, name: string): T {
  Object.defineProperty(target, 'name', { value: name });
  return target;
}

// Members decorated here have no `design:type` metadata, so every ApiProperty names its type.
function decorate(target: object, member: string, ...decorators: PropertyDecorator[]): void {
  for (const decorator of decorators) decorator(target, member);
}

/** `{ data: { type, attributes } }` for a POST, or `{ data: { type, id, attributes } }` for a PATCH. */
export function requestDocument(name: string, type: string, attributes: Class, { withId = false } = {}): Class {
  // `declare` keeps undecorated members off instances, which the whitelist would reject.
  class Resource {
    declare type: string;
    declare id?: string;
    declare attributes: object;
  }
  decorate(Resource.prototype, 'type', ApiProperty({ type: String, enum: [type] }), Equals(type));
  if (withId) decorate(Resource.prototype, 'id', ApiProperty({ type: String }), IsString());
  decorate(Resource.prototype, 'attributes', ApiProperty({ type: attributes }), IsDefined(), ValidateNested(), Type(() => attributes));

  class Document {
    declare data: Resource;
  }
  decorate(Document.prototype, 'data', ApiProperty({ type: Resource }), IsDefined(), ValidateNested(), Type(() => Resource));

  named(Resource, `${name}Resource`);
  return named(Document, `${name}Document`);
}

/** The resource object a vocabulary responds with, for Swagger. */
export function responseResource(name: string, type: string, attributes: Class): Class {
  class Resource extends ResourceIdentifier {}
  decorate(Resource.prototype, 'type', ApiProperty({ type: String, enum: [type] }));
  decorate(Resource.prototype, 'attributes', ApiProperty({ type: attributes }));
  return named(Resource, name);
}
