import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { JsonApiExceptionFilter } from './json-api-exception.filter';
import { JsonApiMediaTypeMiddleware } from './media-type.middleware';
import { jsonApiValidationPipe } from './validation';

@Module({
  providers: [
    { provide: APP_FILTER, useClass: JsonApiExceptionFilter },
    { provide: APP_PIPE, useFactory: jsonApiValidationPipe },
  ],
})
export class JsonApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(JsonApiMediaTypeMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
