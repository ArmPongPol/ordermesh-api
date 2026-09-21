# OrderMesh API

NestJS 11 + TypeORM + PostgreSQL backend for OrderMesh.

## Quick start

```bash
npm install
cp .env.example .env.development     # then edit credentials
npm run db:up                        # Postgres via docker compose
npm run migration:run
npm run start:dev
```

The API listens on `http://localhost:3001`. Swagger UI is at `/docs` (disabled
in production).

## Environment

Config is loaded from `.env.<NODE_ENV>` (`.env.development`, `.env.production`,
`.env.local`) and validated by Joi at boot — a missing or malformed variable
fails startup rather than surfacing later. See [.env.example](.env.example) for
the full list and [.env.production.example](.env.production.example) for the
production template.

Two settings are hard-locked when `NODE_ENV=production`:

| Variable         | Production value | Why                                     |
| ---------------- | ---------------- | --------------------------------------- |
| `DB_SYNCHRONIZE` | `false`          | Schema changes go through migrations     |
| `DOCS_ENABLED`   | `false`          | Swagger is never exposed publicly        |

`JWT_SECRET` is **required in every environment** and has no default — a
defaulted signing key is a backdoor, so the app refuses to boot without one.
Production additionally requires at least 48 characters and rejects the
placeholder shipped in `.env.example`. Generate one with
`openssl rand -base64 48`.

`CORS_ORIGINS` is **required** in production. Outside production an empty value
means "allow any origin". A blocked origin is denied by omitting the CORS
headers, not by returning a 500.

`HEALTH_HEAP_MB` / `HEALTH_RSS_MB` (default 512 / 1024) set the memory
thresholds for `/health`. Keep them under the container memory limit but well
above the process baseline — a Node process routinely sits above 150 MB RSS, so
tight values make the probe flap and restart healthy containers.

## API contract

### Routing

All routes are served under `/{API_PREFIX}/{API_VERSION}` — `/api/v1` by
default. `GET /health` is the single exception: it stays unprefixed so load
balancer and container probes find it at the conventional path, and it returns
the raw Terminus document (200) or the same document with a 503 — never the
envelope, so standard monitoring tooling can parse it either way.

### Success envelope

Every response is wrapped by `TransformResponseInterceptor`:

```json
{
  "success": true,
  "status": 200,
  "message": "Success",
  "data": { }
}
```

A handler may return `{ message, data }` to set a custom message; anything else
becomes `data` verbatim. Falsy payloads (`0`, `""`, `false`) are preserved — only
`undefined` becomes `null`.

Annotate a route with `@SkipTransform()` to opt out (used by `/health`, and
appropriate for file downloads and third-party webhook callbacks).

### Error envelope

`HttpExceptionFilter` catches everything and returns:

```json
{
  "success": false,
  "status": 400,
  "message": "Validation failed",
  "data": null,
  "code": "VALIDATION_ERROR",
  "errors": { "email": ["email must be an email"] },
  "timestamp": "2026-09-07T10:30:41.876Z",
  "path": "/api/v1/orders",
  "requestId": "914486cf-c0c1-41d0-82e3-25ba06496987"
}
```

- `code` is a stable, machine-readable value from
  [`ErrorCode`](src/common/constants/error-code.ts). **Branch on `code`, never on
  `message`.**
- `errors` appears only on `VALIDATION_ERROR`, grouped per field so a client can
  bind messages to form inputs.
- `requestId` matches the `x-request-id` response header, set by
  `RequestIdMiddleware` (an inbound header is reused, otherwise a UUID is
  generated).
- Unexpected (non-`HttpException`) errors always report
  `"Internal server error"` / `INTERNAL_ERROR`. Outside production a `details`
  field carries the error name and message; in production it is omitted.

### Validation

The global `ValidationPipe` runs with `whitelist`, `forbidNonWhitelisted` and
`transform` enabled — an unknown property in a body or query string is a 400,
not a silent drop.

### Pagination

List endpoints take [`PaginationQueryDto`](src/common/dto/pagination-query.dto.ts)
(`page`, `limit`, `sortBy`, `sortDirection`) and return
[`PaginatedDto`](src/common/dto/paginated.dto.ts) inside `data`:

```json
{ "data": { "items": [], "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0, "hasNext": false, "hasPrevious": false } } }
```

### Documenting a route

The interceptor wraps responses at runtime, so Swagger must be told about the
envelope explicitly or the generated spec will describe the bare model:

```ts
@Get(':id')
@ApiEnvelopeResponse(OrderDto)
@ApiEnvelopeErrorResponse(404, 'Order not found')
findOne(@Param('id') id: string) { ... }
```

See [api-response.decorator.ts](src/common/decorators/api-response.decorator.ts)
for the array and paginated variants.

## Authentication & RBAC

Every route requires a valid access token unless it is marked `@Public()`
(`JwtAuthGuard` is registered as a global `APP_GUARD`). `/health` is public so
probes still reach it.

### Endpoints

| Method | Path                   | Auth   | Returns                              |
| ------ | ---------------------- | ------ | ------------------------------------ |
| POST   | `/api/v1/auth/register`| public | 201 `{ user, tokens }`               |
| POST   | `/api/v1/auth/login`   | public | 200 `{ user, tokens }`               |
| POST   | `/api/v1/auth/refresh` | public | 200 `{ tokens }`                     |
| POST   | `/api/v1/auth/logout`  | bearer | 200, ends this session               |
| POST   | `/api/v1/auth/logout-all` | bearer | 200 `{ revoked }`                 |
| GET    | `/api/v1/auth/me`      | bearer | 200 the profile, roles, permissions  |

Send the access token as `Authorization: Bearer <accessToken>`.

### Tokens

A short-lived **access token** (15 min) plus a long-lived **refresh token**
(30 days sliding, 90 days absolute). The access token carries no authorization
data — only `sub`, `jti` and the registered claims — so a revoked role or a
suspended account takes effect without waiting for it to expire.

Refresh tokens are **single use**. Every refresh returns a new one and retires
the old; presenting a retired token is treated as theft and revokes the whole
session family with `TOKEN_REUSE_DETECTED`. They are stored only as argon2
hashes, in the compound form `<row id>.<secret>` — salted hashes are not
searchable, so the row id travels with the secret.

### Roles and permissions

Both live in the database, so an admin can retune a role without a deploy.
Routes declare what they need, never who may call them:

```ts
@RequirePermissions(PERMISSIONS.ORDER_UPDATE_ANY)     // one
@RequirePermissions(PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_ADJUST)  // AND
@RequirePermissions({ any: [PERMISSIONS.ORDER_CANCEL, PERMISSIONS.ORDER_CANCEL_ANY] })  // OR
```

Codes are `<resource>:<action>`. A trailing **`:any`** means "across all
owners"; the bare form means "own records only" — `order:read` and
`order:read:any` are different grants, and the service layer is responsible for
applying the owner filter when only the bare form is held.

Seeded roles: `ADMIN` (all), `OPS_MANAGER`, `WAREHOUSE_STAFF`, `SUPPORT`,
`CUSTOMER` (granted automatically on registration). The catalogue lives in
[permissions.ts](src/rbac/constants/permissions.ts) and
[roles.ts](src/rbac/constants/roles.ts); the migration seeds it, and a unit test
fails the build if the two drift apart.

Permissions are resolved **from the database on each request** (one query),
memoised for `AUTH_PERMISSION_CACHE_TTL_MS`. That TTL is the upper bound on how
long a revoked role or a suspension can still be honoured; it is `0` outside
production. Note the cache is per process — with more than one instance, use
the TTL as the convergence window.

### Creating the first admin

Roles and permissions are seeded by the migration. The first admin **user** is
not, because a password in a migration is a credential in git:

```bash
BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_PASSWORD='...' npm run seed:admin
```

It refuses to run if that account already exists, so it can never reset an
existing admin's password.

### Security notes

- **Passwords** are argon2id at the OWASP baseline (19 MiB, t=2, p=1), with
  `needsRehash` upgrading each hash on the owner's next login.
- **Login does not reveal whether an email is registered**: identical status,
  code and message for both failures, and an unknown email still pays for a
  dummy argon2 verify so the two take comparable time.
- **Registration does** reveal it, via `409 EMAIL_ALREADY_EXISTS`. That is an
  accepted trade-off — hiding it requires email verification, which is not yet
  implemented — and the endpoint carries the login throttle to keep enumeration
  slow.
- **Emails are stored as typed and matched case-insensitively** through the
  `uq_users_email_lower` expression index. Do not add a plain unique constraint
  on the column; see the note in [schema.dbml](docs/schema.dbml).
- **`password_hash` is `select: false`** and controllers return DTOs, never
  entities. `@Exclude()` would be a no-op — there is no `ClassSerializerInterceptor`.
- **A suspended or inactive account gets 403**, not 401: the credential is
  valid, the account is not, and a 401 would send clients into a refresh loop.
- **Credential endpoints are throttled** to `AUTH_LOGIN_THROTTLE_LIMIT` per
  minute per *(IP, email)* pair, with a lockout of `AUTH_LOGIN_BLOCK_MS`.
  Tracking by email alone would let anyone lock a known account out of its own
  login. The global per-IP limit still applies underneath and catches stuffing
  spread across many addresses.

> Throttler storage is in-memory, so counters are per process: a multi-instance
> deploy divides the effective login limit by the instance count. Moving to the
> Redis storage is the fix when that happens.

## Migrations

`synchronize` is off everywhere; the schema is owned by migrations.

```bash
npm run migration:generate    # writes src/database/migrations/Migration<ts>.ts
npm run migration:create      # empty migration, for raw SQL you must hand-write
npm run migration:run
npm run migration:revert
```

The CLI `DataSource` and the running app share one options factory
([typeorm.options.ts](src/config/typeorm.options.ts)) so they cannot drift apart.

### What `migration:generate` cannot do

Some DDL is invisible to TypeORM's schema differ and **must** be hand-written in
a `migration:create` file — expression indexes (`lower(email)`), partial indexes
(`WHERE revoked_at IS NULL`), `DEFAULT now()`, and seed rows.

**Constraint names are load-bearing.** TypeORM matches CHECK constraints and
foreign keys by *name only*, so every hand-written constraint needs an
identically named `@Check(...)` / `@JoinColumn({ foreignKeyConstraintName })` on
the entity — with a matching `onDelete`. If they disagree, every subsequent
`migration:generate` emits phantom `DROP`/`ADD CONSTRAINT` churn.

After writing a migration, run `npm run migration:generate` as a **drift check**:

```
No changes in database schema were found
```

Anything else means the entities and the SQL disagree.

## Scripts

| Script                   | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `npm run start:dev`      | Watch mode                                       |
| `npm run build`          | Compile to `dist/`                               |
| `npm run start:prod`     | Run the compiled build                           |
| `npm run check`          | `tsc --noEmit` (strict)                          |
| `npm run lint` / `lint:ci` | ESLint with / without `--fix`                  |
| `npm test` / `test:e2e`  | Unit / end-to-end tests                          |
| `npm run docs:json`      | Emit `openapi.json` for frontend codegen         |
| `npm run db:up` / `db:down` | Postgres container up / down                  |
| `npm run seed:admin`     | Create the first ADMIN user (see Authentication) |

## Docker

`docker compose up -d database` starts only Postgres (what local development
needs). The API image is behind a profile:

```bash
docker compose --profile full up --build
```

The [Dockerfile](Dockerfile) is multi-stage and runs as the non-root `node` user
under `dumb-init`, so `SIGTERM` reaches Nest and `enableShutdownHooks()` can
drain connections.

## Testing

Unit specs cover the contract primitives — the response interceptor, the
exception filter and the request-id middleware — and the auth stack: password
hashing, token signing, refresh rotation and reuse detection, both guards, and
the RBAC catalogue drift check.

`test/app.e2e-spec.ts` boots the whole app and asserts the routing, envelope and
error shape end to end. `test/auth.e2e-spec.ts` walks the full flow — register,
login, refresh, replay a retired token, logout-all — against a real database.
Both need a reachable Postgres with migrations applied:

```bash
npm run db:up && npm run migration:run && npm run test:e2e
```

[test/setup-e2e.ts](test/setup-e2e.ts) raises the credential rate limits for the
suite, which otherwise throttles itself.
