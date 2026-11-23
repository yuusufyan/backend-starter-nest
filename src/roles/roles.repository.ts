import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  BaseRepository,
  type DbExecutor,
  type Result,
} from '../database/base.repository.js';
import { roles } from './roles.schema.js';

@Injectable()
export class RolesRepository extends BaseRepository<typeof roles> {
  constructor(@InjectDrizzle() db: NodePgDatabase) {
    super(db, roles, { searchColumns: [roles.name, roles.description] });
  }

  findByName(
    name: string,
    tx?: DbExecutor,
  ): Promise<Result<typeof roles> | undefined> {
    return this.findOneBy(eq(roles.name, name), tx);
  }
}
