import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogIdentity, Organization, Person } from './entities/catalog-identity.entity';
import {
  CatalogIdentityAlias,
  CatalogIdentityPlatformLink,
  OrganizationTypeAssignment,
  PersonNationality,
} from './entities/identity-relation.entity';
import { IdentitiesController } from './identities.controller';
import { IdentitiesService } from './identities.service';

/**
 * Identities of the catalog: people and organizations. Their rows only exist
 * once the editorial flow applies a creation, through `identity-creations.ts`;
 * this module serves their public reads.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CatalogIdentity,
      Person,
      Organization,
      CatalogIdentityAlias,
      PersonNationality,
      OrganizationTypeAssignment,
      CatalogIdentityPlatformLink,
    ]),
  ],
  controllers: [IdentitiesController],
  providers: [IdentitiesService],
})
export class CatalogIdentitiesModule {}
