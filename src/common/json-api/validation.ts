import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { JsonApiErrorInput, JsonApiException } from './json-api.exception';

/**
 * Validates request bodies against their DTOs and reports every failure as a
 * 422 error whose `source.pointer` names the offending member. Members the DTO
 * does not declare are rejected.
 */
export function jsonApiValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors) => new JsonApiException(HttpStatus.UNPROCESSABLE_ENTITY, toErrors(errors, '')),
  });
}

function toErrors(errors: ValidationError[], parentPointer: string): JsonApiErrorInput[] {
  return errors.flatMap((error) => {
    const pointer = `${parentPointer}/${escapePointerToken(error.property)}`;
    const own = Object.values(error.constraints ?? {}).map((detail) => ({ detail, source: { pointer } }));
    return [...own, ...toErrors(error.children ?? [], pointer)];
  });
}

/** RFC 6901: `~` and `/` are escaped inside a JSON Pointer reference token. */
function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}
