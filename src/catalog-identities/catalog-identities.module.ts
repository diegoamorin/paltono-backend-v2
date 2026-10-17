import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogIdentity, Organization, Person } from './entities/catalog-identity.entity';

/**
 * Identities of the catalog: people and organizations. Their rows only exist
 * once the editorial flow applies a creation; the public reads come later.
 */
@Module({
  imports: [TypeOrmModule.forFeature([CatalogIdentity, Person, Organization])],
})
export class CatalogIdentitiesModule {}
