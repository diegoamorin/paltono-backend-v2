import { DynamicModule, Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from './accounts/accounts.module';
import { CatalogIdentitiesModule } from './catalog-identities/catalog-identities.module';
import { ClockModule } from './common/clock/clock.module';
import { JsonApiModule } from './common/json-api/json-api.module';
import { MailModule } from './common/mail/mail.module';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { databaseOptions } from './database/database-options';
import { EditorialModule } from './editorial/editorial.module';
import { HealthModule } from './health/health.module';
import { VocabulariesModule } from './vocabularies/vocabularies.module';

@Global()
@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        TypeOrmModule.forRoot({ ...databaseOptions(config.databaseUrl), entities: [], autoLoadEntities: true }),
        ClockModule,
        JsonApiModule,
        MailModule,
        HealthModule,
        AccountsModule,
        VocabulariesModule,
        CatalogIdentitiesModule,
        EditorialModule,
      ],
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
