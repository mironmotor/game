import 'server-only';

import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from './schema';

function createDatabase(databaseUrl: string) {
  return drizzle(databaseUrl, { schema });
}

export type Database = ReturnType<typeof createDatabase>;

let database: Database | undefined;

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('DATABASE_URL is not configured. Connect a Neon database to this Vercel project.');
    this.name = 'DatabaseNotConfiguredError';
  }
}

/**
 * Neon HTTP is stateless, so one lazy Drizzle instance can be reused by a warm
 * Vercel function. Laziness keeps builds and static rendering independent from
 * database credentials until a server request actually needs persistence.
 */
export function getDb(): Database {
  if (database) return database;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new DatabaseNotConfiguredError();

  database = createDatabase(databaseUrl);
  return database;
}

