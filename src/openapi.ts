import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { AppModule } from './app.module';

/**
 * Emits the OpenAPI document to openapi.json without serving traffic, so the
 * frontend can generate a typed client from the same contract the API enforces.
 *
 *   npm run docs:json
 */
async function generate() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  const config = app.get(ConfigService);

  app.setGlobalPrefix(
    [config.get<string>('app.apiPrefix'), config.get<string>('app.apiVersion')]
      .filter(Boolean)
      .join('/'),
    { exclude: ['health'] },
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle(config.get<string>('docs.title') ?? 'OrderMesh API')
    .setDescription(config.get<string>('docs.description') ?? '')
    .setVersion(config.get<string>('docs.version') ?? '1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  const outPath = resolve(process.cwd(), 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2));

  await app.close();
  console.log(`OpenAPI spec written to ${outPath}`);
}

generate().catch((err) => {
  console.error('Failed to generate OpenAPI spec', err);
  process.exit(1);
});
