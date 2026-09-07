import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  buildDataSourceOptions,
  DatabaseSettings,
} from '../config/typeorm.options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const settings: DatabaseSettings = {
          host: config.get<string>('database.host')!,
          port: config.get<number>('database.port')!,
          username: config.get<string>('database.username')!,
          password: config.get<string>('database.password')!,
          database: config.get<string>('database.database')!,
          synchronize: config.get<boolean>('database.synchronize') ?? false,
          logging: config.get<boolean>('database.logging') ?? false,
          ssl: config.get<boolean>('database.ssl') ?? false,
        };

        return {
          ...buildDataSourceOptions(
            settings,
            config.get<string>('app.env') === 'production',
          ),
          autoLoadEntities: true,
          retryAttempts: 5,
          retryDelay: 3000,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
