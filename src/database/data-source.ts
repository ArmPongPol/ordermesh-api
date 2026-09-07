import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import {
  buildDataSourceOptions,
  readDatabaseSettingsFromEnv,
} from '../config/typeorm.options';

const nodeEnv = process.env.NODE_ENV ?? 'development';

// Mirror AppModule's envFilePath selection: the CLI must read the same file the
// running app does, not the bare `.env` that dotenv/config would auto-load.
const envFile =
  nodeEnv === 'production'
    ? '.env.production'
    : nodeEnv === 'local'
      ? '.env.local'
      : nodeEnv === 'test'
        ? ['.env.test', '.env.development']
        : '.env.development';

dotenv.config({ path: envFile });

const isProduction = nodeEnv === 'production';

export default new DataSource({
  ...buildDataSourceOptions(readDatabaseSettingsFromEnv(), isProduction),
  entities: [isProduction ? 'dist/**/*.entity.js' : 'src/**/*.entity.ts'],
  migrations: [
    isProduction
      ? 'dist/database/migrations/*.js'
      : 'src/database/migrations/*.ts',
  ],
});
