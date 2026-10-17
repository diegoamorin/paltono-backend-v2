import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module';
import { ContributionRolesController, ContributionRolesStore } from './contribution-roles';
import { CountriesController, CountriesStore } from './countries';
import { ContributionRole, ContributionRoleScope } from './entities/contribution-role.entity';
import { Country } from './entities/country.entity';
import { Genre } from './entities/genre.entity';
import { OrganizationType } from './entities/organization-type.entity';
import { Platform } from './entities/platform.entity';
import { GenresController, GenresStore } from './genres';
import { OrganizationTypesController, OrganizationTypesStore } from './organization-types';
import { PlatformsController, PlatformsStore } from './platforms';

/** Shared vocabularies: public reads and administrator writes, outside the editorial flow. */
@Module({
  imports: [AccountsModule, TypeOrmModule.forFeature([Country, Genre, Platform, OrganizationType, ContributionRole, ContributionRoleScope])],
  controllers: [CountriesController, GenresController, PlatformsController, OrganizationTypesController, ContributionRolesController],
  providers: [CountriesStore, GenresStore, PlatformsStore, OrganizationTypesStore, ContributionRolesStore],
})
export class VocabulariesModule {}
