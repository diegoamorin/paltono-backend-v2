import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CatalogIdentity, Organization, Person } from './entities/catalog-identity.entity';
import { IdentityEntry } from './identity.resource';

/** Public reads of identities. A row only exists once its creation is applied, so a reservation is never found. */
@Injectable()
export class IdentitiesService {
  constructor(private readonly dataSource: DataSource) {}

  async show(publicId: string): Promise<IdentityEntry> {
    const manager = this.dataSource.manager;
    const identity = await manager.findOneBy(CatalogIdentity, { publicId });
    if (!identity) {
      throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'identity_not_found', detail: 'The identity does not exist' }]);
    }
    const [person, organization] = await Promise.all([
      manager.findOneBy(Person, { catalogIdentityId: identity.id }),
      manager.findOneBy(Organization, { catalogIdentityId: identity.id }),
    ]);
    return { identity, person, organization };
  }
}
