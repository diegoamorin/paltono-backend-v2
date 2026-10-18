import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Artist, ArtistOrganizationAffiliation, OrganizationMembership, OrganizationMembershipRole } from './entities/artist.entity';
import { CatalogIdentity, Organization, Person } from './entities/catalog-identity.entity';
import {
  CatalogIdentityAlias,
  CatalogIdentityPlatformLink,
  OrganizationTypeAssignment,
  PersonNationality,
} from './entities/identity-relation.entity';
import { ArtistsController } from './artists.controller';
import { ArtistsService } from './artists.service';
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
      Artist,
      OrganizationMembership,
      OrganizationMembershipRole,
      ArtistOrganizationAffiliation,
    ]),
  ],
  controllers: [IdentitiesController, ArtistsController],
  providers: [IdentitiesService, ArtistsService],
})
export class CatalogIdentitiesModule {}
