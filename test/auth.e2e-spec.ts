import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';

/**
 * The full authentication flow against a real database.
 * Requires a reachable Postgres with migrations applied
 * (`npm run db:up && npm run migration:run`).
 *
 * Uses a per-run random address so repeated local runs do not collide, and
 * deletes the account afterwards so the table does not accumulate rows.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;

  // Mixed case on purpose: registration must store it verbatim while every
  // lookup matches case-insensitively.
  const EMAIL = `E2E.Somchai+${randomUUID().slice(0, 8)}@Example.com`;
  const PASSWORD = 'a long enough passphrase';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    if (app) {
      // refresh_tokens and user_roles cascade from the user.
      await app
        .get(DataSource)
        .query(`DELETE FROM "users" WHERE lower("email") = lower($1)`, [EMAIL]);
      await app.close();
    }
  });

  /** The success envelope, narrowed enough for the assertions below. */
  interface SessionBody {
    success: boolean;
    status: number;
    code?: string;
    message?: string;
    data: {
      user: {
        email: string;
        status: string;
        roles: string[];
        permissions: string[];
      };
      tokens: {
        accessToken: string;
        refreshToken: string;
        tokenType: string;
        expiresIn: number;
      };
      revoked?: number;
    };
  }

  const post = (path: string, body: object) =>
    request(http).post(`/api/v1${path}`).send(body);

  const bodyOf = (res: request.Response) => res.body as SessionBody;

  describe('register', () => {
    it('creates an account, grants CUSTOMER and returns a session', async () => {
      const res = await post('/auth/register', {
        email: EMAIL,
        password: PASSWORD,
        fullName: 'Somchai Jaidee',
      });

      expect(res.status).toBe(201);
      expect(bodyOf(res)).toMatchObject({ success: true, status: 201 });

      const { user, tokens } = bodyOf(res).data;
      expect(user.email).toBe(EMAIL); // stored exactly as typed
      expect(user.roles).toEqual(['CUSTOMER']);
      expect(user.permissions).toEqual(
        expect.arrayContaining(['order:create', 'order:read']),
      );
      expect(user.permissions).not.toContain('order:read:any');
      expect(tokens).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });

      // The single most important assertion in this file.
      expect(JSON.stringify(bodyOf(res))).not.toMatch(
        /passwordHash|password_hash|\$argon2/,
      );
    });

    it('rejects a duplicate email that differs only in case', async () => {
      const res = await post('/auth/register', {
        email: EMAIL.toUpperCase(),
        password: PASSWORD,
        fullName: 'Impostor',
      });

      expect(res.status).toBe(409);
      expect(bodyOf(res).code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('rejects a short password and an unknown field', async () => {
      const short = await post('/auth/register', {
        email: `x${randomUUID().slice(0, 6)}@example.com`,
        password: 'short',
        fullName: 'X',
      });
      expect(short.status).toBe(400);
      expect(bodyOf(short).code).toBe('VALIDATION_ERROR');

      const extra = await post('/auth/register', {
        email: `y${randomUUID().slice(0, 6)}@example.com`,
        password: PASSWORD,
        fullName: 'Y',
        isAdmin: true,
      });
      expect(extra.status).toBe(400);
    });
  });

  describe('login', () => {
    it('accepts a different casing and surrounding whitespace', async () => {
      const res = await post('/auth/login', {
        email: `  ${EMAIL.toLowerCase()}  `,
        password: PASSWORD,
      });

      expect(res.status).toBe(200);
      expect(bodyOf(res).data.user.roles).toEqual(['CUSTOMER']);
    });

    // Anything that distinguishes these two turns login into an oracle for
    // which addresses are registered.
    it('answers identically for a wrong password and an unknown email', async () => {
      const wrongPassword = await post('/auth/login', {
        email: EMAIL,
        password: 'definitely-not-the-password',
      });
      const unknownEmail = await post('/auth/login', {
        email: `nobody-${randomUUID().slice(0, 8)}@example.com`,
        password: 'definitely-not-the-password',
      });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(wrongPassword.status);
      expect(bodyOf(unknownEmail).code).toBe('INVALID_CREDENTIALS');
      expect(bodyOf(unknownEmail).message).toBe(bodyOf(wrongPassword).message);
    });
  });

  describe('protected routes', () => {
    it('refuses /auth/me without, or with a malformed, token', async () => {
      for (const header of [undefined, 'Basic abc', 'Bearer not-a-jwt']) {
        const req = request(http).get('/api/v1/auth/me');
        if (header) req.set('authorization', header);
        const res = await req;

        expect(res.status).toBe(401);
        expect(bodyOf(res).code).toBe('INVALID_TOKEN');
      }
    });

    it('returns the profile with roles and permissions when authenticated', async () => {
      const login = await post('/auth/login', {
        email: EMAIL,
        password: PASSWORD,
      });
      const res = await request(http)
        .get('/api/v1/auth/me')
        .set(
          'authorization',
          `Bearer ${bodyOf(login).data.tokens.accessToken}`,
        );

      expect(res.status).toBe(200);
      expect(bodyOf(res).data).toMatchObject({
        email: EMAIL,
        status: 'ACTIVE',
        roles: ['CUSTOMER'],
      });
      expect(JSON.stringify(bodyOf(res))).not.toMatch(/passwordHash|\$argon2/);
    });
  });

  describe('refresh rotation', () => {
    it('rotates the token, and replaying the old one kills the family', async () => {
      const login = await post('/auth/login', {
        email: EMAIL,
        password: PASSWORD,
      });
      const first = bodyOf(login).data.tokens.refreshToken;

      const rotated = await post('/auth/refresh', { refreshToken: first });
      expect(rotated.status).toBe(200);

      const second = bodyOf(rotated).data.tokens.refreshToken;
      expect(second).not.toBe(first);

      // Replaying a retired token is the signature of a stolen one.
      const replay = await post('/auth/refresh', { refreshToken: first });
      expect(replay.status).toBe(401);
      expect(bodyOf(replay).code).toBe('TOKEN_REUSE_DETECTED');

      // ...and the still-live replacement dies with the rest of the family.
      // This is the assertion that catches the revocation being rolled back
      // by the transaction it was issued in.
      const afterReuse = await post('/auth/refresh', { refreshToken: second });
      expect(afterReuse.status).toBe(401);
      expect(bodyOf(afterReuse).code).toBe('TOKEN_REUSE_DETECTED');
    });

    it('rejects a malformed refresh token without a 500', async () => {
      for (const token of ['garbage', 'not-a-uuid.secret', '.secret', 'id.']) {
        const res = await post('/auth/refresh', { refreshToken: token });

        expect(res.status).toBe(401);
        expect(bodyOf(res).code).toBe('INVALID_TOKEN');
      }
    });
  });

  describe('logout', () => {
    it('logout-all ends every session and reports the count', async () => {
      const a = await post('/auth/login', { email: EMAIL, password: PASSWORD });
      const b = await post('/auth/login', { email: EMAIL, password: PASSWORD });

      const res = await request(http)
        .post('/api/v1/auth/logout-all')
        .set('authorization', `Bearer ${bodyOf(b).data.tokens.accessToken}`)
        .send({});

      expect(res.status).toBe(200);
      // 200 with a body, never 204 — Express drops the body on a 204 and the
      // response envelope would be lost.
      expect(bodyOf(res).success).toBe(true);
      expect(bodyOf(res).data.revoked).toBeGreaterThanOrEqual(2);

      // Both sessions' refresh tokens are now dead.
      for (const session of [a, b]) {
        const refresh = await post('/auth/refresh', {
          refreshToken: bodyOf(session).data.tokens.refreshToken,
        });
        expect(refresh.status).toBe(401);
      }
    });
  });
});
