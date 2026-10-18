import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { pageWindow } from '../common/json-api/document';
import { CollectionQuery, requireOneOf } from '../common/json-api/query';
import { containsPattern } from '../database/like-pattern';
import { accountNotFound } from './administration';
import { USER_ROLES, USER_STATUSES, User } from './entities/user.entity';

/** Sortable fields and their columns; accounts that never logged in sort last either way. */
const SORT_COLUMNS: Record<string, string> = {
  id: 'user.id',
  createdAt: 'user.created_at',
  username: 'user.username',
  lastLoginAt: 'user.last_login_at',
};

/** Administrative reads of accounts, including their email (P5). */
@Injectable()
export class AdminUsersService {
  constructor(private readonly dataSource: DataSource) {}

  /** One page of accounts matching the filters of U1. */
  async list(query: CollectionQuery): Promise<{ users: User[]; total: number }> {
    const builder = this.dataSource.getRepository(User).createQueryBuilder('user');
    const { q, role, status, emailVerified } = query.filter;

    if (q !== undefined) {
      const pattern = containsPattern(q);
      builder.andWhere('(user.username ILIKE :pattern OR user.email ILIKE :pattern OR user.display_name ILIKE :pattern)', {
        pattern,
      });
    }
    if (role !== undefined) {
      requireOneOf('filter[role]', role, USER_ROLES);
      builder.andWhere('user.role = :role', { role });
    }
    if (status !== undefined) {
      requireOneOf('filter[status]', status, USER_STATUSES);
      builder.andWhere('user.status = :status', { status });
    }
    if (emailVerified !== undefined) {
      requireOneOf('filter[emailVerified]', emailVerified, ['true', 'false']);
      builder.andWhere('user.email_verified = :emailVerified', { emailVerified: emailVerified === 'true' });
    }

    for (const { field, direction } of query.sort) builder.addOrderBy(SORT_COLUMNS[field], direction, 'NULLS LAST');
    const { skip, take } = pageWindow(query);
    const [users, total] = await builder.offset(skip).limit(take).getManyAndCount();
    return { users, total };
  }

  async show(userUuid: string): Promise<User> {
    const user = await this.dataSource.getRepository(User).findOneBy({ uuid: userUuid });
    if (!user) throw accountNotFound();
    return user;
  }
}
