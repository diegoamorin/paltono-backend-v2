import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/** Global search across the catalog; it owns no tables. */
@Module({ controllers: [SearchController], providers: [SearchService] })
export class DiscoveryModule {}
