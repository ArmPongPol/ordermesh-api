import type { DataSourceOptions } from 'typeorm';

export interface DatabaseSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  synchronize: boolean;
  logging: boolean;
  ssl: boolean;
}

/**
 * Single source of truth for TypeORM connection options, shared by the Nest
 * runtime (`DatabaseModule`) and the migration CLI (`data-source.ts`) so the
 * two can no longer drift apart.
 */
export function buildDataSourceOptions(
  settings: DatabaseSettings,
  isProduction: boolean,
): DataSourceOptions {
  return {
    type: 'postgres',
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: settings.password,
    database: settings.database,
    synchronize: settings.synchronize,
    logging: settings.logging,
    ssl: settings.ssl ? { rejectUnauthorized: isProduction } : false,
  };
}

export function readDatabaseSettingsFromEnv(): DatabaseSettings {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'ordermesh',
    // The CLI never syncs; migrations are the only schema path.
    synchronize: false,
    logging: process.env.DB_LOGGING === 'true',
    ssl: process.env.DB_SSL === 'true',
  };
}
