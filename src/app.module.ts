import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import docsConfig from './config/docs.config';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor';

function envFilePathFor(nodeEnv: string | undefined): string | string[] {
  switch (nodeEnv) {
    case 'production':
      return '.env.production';
    case 'local':
      return '.env.local';
    // Jest sets NODE_ENV=test; fall back to the dev file when there is no
    // dedicated test env so `npm run test:e2e` works out of the box.
    case 'test':
      return ['.env.test', '.env.development'];
    default:
      return '.env.development';
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
      isGlobal: true,
      envFilePath: envFilePathFor(process.env.NODE_ENV),
      load: [appConfig, databaseConfig, docsConfig],
      validationSchema: envValidationSchema,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('app.throttleTtl') ?? 60000,
            limit: config.get<number>('app.throttleLimit') ?? 120,
          },
        ],
      }),
    }),
    DatabaseModule,
    HealthModule,
  ],
  controllers: [],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Registered as providers (not `new` in main.ts) so they can inject ConfigService.
    { provide: APP_INTERCEPTOR, useClass: TransformResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
