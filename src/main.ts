import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, LogLevel, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { json, urlencoded } from 'express';

const PRODUCTION_LOG_LEVELS: LogLevel[] = ['error', 'warn', 'log'];
const DEFAULT_LOG_LEVELS: LogLevel[] = [
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
];

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create(AppModule, {
    logger: isProduction ? PRODUCTION_LOG_LEVELS : DEFAULT_LOG_LEVELS,
  });
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);

  const host = configService.getOrThrow<string>('app.host');
  const port = configService.get<number>('app.port') ?? 3001;
  const corsOrigin = configService.get<string[]>('app.corsOrigin') || [];
  const corsCredentials = configService.get<boolean>('app.corsCredentials');

  const apiPrefix = configService.get<string>('app.apiPrefix');
  const apiVersion = configService.get<string>('app.apiVersion');
  const globalPrefix = [apiPrefix, apiVersion].filter(Boolean).join('/');

  if (globalPrefix) {
    // `health` stays unprefixed as well, since probes default to /health.
    app.setGlobalPrefix(globalPrefix, { exclude: ['health'] });
    logger.log(`Global prefix set to: ${globalPrefix}`);
  }

  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(compression());
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Same-origin / non-browser clients (curl, health probes) send no Origin.
      if (!origin) {
        return callback(null, true);
      }

      // Outside production an empty allowlist means "allow anything".
      if (corsOrigin.length === 0 && !isProduction) {
        return callback(null, true);
      }

      if (corsOrigin.includes(origin)) {
        return callback(null, true);
      }

      // Deny by omitting the CORS headers. Passing an Error here would surface
      // as a 500 on an otherwise valid request; the browser blocks it either
      // way, and non-browser clients are unaffected by CORS at all.
      logger.warn(`Blocked CORS request from origin: ${origin}`);
      return callback(null, false);
    },
    credentials: corsCredentials,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // The response envelope and error filter are registered as APP_INTERCEPTOR /
  // APP_FILTER providers in AppModule so they can inject ConfigService.

  app.enableShutdownHooks();

  const docsEnabled = configService.get<boolean>('docs.enabled');
  if (docsEnabled) {
    const docPath = configService.get<string>('docs.path') ?? 'docs';
    const swaggerConfig = new DocumentBuilder()
      .setTitle(configService.get<string>('docs.title') ?? 'API Documentation')
      .setDescription(
        configService.get<string>('docs.description') ?? 'API Documentation',
      )
      .setVersion(configService.get<string>('docs.version') ?? '1.0.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(docPath, app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
    logger.log(
      `Swagger docs available at: http://localhost:${port}/${docPath}`,
    );
  }

  await app.listen(port, host);
  logger.log(`Application is running on: http://${host}:${port}`);
}
bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error('Error during application bootstrap', err);
  process.exit(1);
});
