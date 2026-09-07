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

## Migrations

`synchronize` is off everywhere; the schema is owned by migrations.

```bash
npm run migration:generate    # writes src/database/migrations/Migration<ts>.ts
npm run migration:run
npm run migration:revert
```

The CLI `DataSource` and the running app share one options factory
([typeorm.options.ts](src/config/typeorm.options.ts)) so they cannot drift apart.

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
exception filter and the request-id middleware. `test/app.e2e-spec.ts` boots the
whole app and asserts the routing, envelope and error shape end to end; it needs
a reachable Postgres.
