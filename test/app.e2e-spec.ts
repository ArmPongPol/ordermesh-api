import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { ApiErrorResponseDto } from './../src/common/dto/api-response.dto';

/**
 * Exercises the global contract: prefix, envelope, error shape, request id.
 * Requires a reachable Postgres (docker compose up -d database).
 */
describe('API contract (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirror main.ts. The envelope interceptor and error filter come from
    // AppModule providers, so they are already active here.
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves health unprefixed and unwrapped, pass or fail', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect([200, 503]).toContain(res.status);
    // Terminus shape passes through untouched in both directions - no envelope.
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('info');
    expect(res.body).toHaveProperty('details');
    expect(res.body).not.toHaveProperty('success');
    expect(res.body).toHaveProperty('details.database.status', 'up');
  });

  it('echoes a request id header on every response', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.headers['x-request-id']).toEqual(expect.any(String));
    expect(res.headers['x-request-id']).not.toHaveLength(0);
  });

  it('reuses an inbound request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', 'e2e-fixed-id');

    expect(res.headers['x-request-id']).toBe('e2e-fixed-id');
  });

  it('returns the error envelope for an unknown route', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/does-not-exist',
    );
    const body = res.body as ApiErrorResponseDto;

    expect(res.status).toBe(404);
    expect(body).toMatchObject({
      success: false,
      status: 404,
      data: null,
      code: 'NOT_FOUND',
      path: '/api/v1/does-not-exist',
    });
    expect(body.requestId).toEqual(expect.any(String));
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it('applies the global prefix (health is the only exclusion)', async () => {
    const res = await request(app.getHttpServer()).get('/orders');

    expect(res.status).toBe(404);
  });
});
