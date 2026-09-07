# API Contract Hardening — สรุปการเปลี่ยนแปลง

**วันที่:** 2026-09-07
**ขอบเขต:** `backend/` เท่านั้น (ไม่แตะ `frontend/`)
**สถานะ:** เสร็จตามขอบเขตที่ตกลง — ยังไม่ทำ auth และ CI

---

## 1. ที่มา

ตรวจ API contract ที่เตรียมไว้สำหรับ backend แล้วพบบั๊กที่ `tsc --noEmit` จับไม่ได้
เพราะเป็น logic bug ไม่ใช่ type error โดยมี 5 จุดที่รุนแรงพอจะทำให้ production พัง
(schema auto-sync เปิดอยู่, CORS ปิดทุก origin, ต่อ DB ผิดตัวแปร, SSL ไม่ทำงาน,
import ผูกกับ layout ของ `node_modules`)

| ด้าน | ก่อน | หลัง |
| --- | --- | --- |
| Development | 6/10 | 8.5/10 |
| Production | 3/10 | 7.5/10 |
| API contract | 5/10 | 8.5/10 |

---

## 2. บั๊กที่แก้

### 2.1 `synchronize` กลับด้าน — เสี่ยงข้อมูลหาย (P0)

`src/config/database.config.ts`

```diff
- synchronize: process.env.DB_SYNCHRONIZE === 'false',
+ synchronize: process.env.DB_SYNCHRONIZE === 'true',
```

ค่า `DB_SYNCHRONIZE=false` ที่ตั้งไว้ทำให้ TypeORM `synchronize` เป็น **`true`**
คือ auto-sync schema เปิดอยู่ตอนที่ config บอกว่าปิด และ `env.validation.ts`
ที่บังคับ `valid(false)` ใน production ยิ่งทำให้เป็น `true` แน่นอน

### 2.2 CORS พังทั้งหมดใน production (P0)

`src/config/app.config.ts` + `src/main.ts`

- config อ่าน `CORS_ORIGIN` (เอกพจน์) แต่ Joi validate `CORS_ORIGINS` (พหูพจน์)
  → prod ที่ตั้งตาม validation จะได้ allowlist ว่าง แล้วบล็อกทุก origin
- `''.split(',')` คืน `['']` ไม่ใช่ `[]` → เงื่อนไข `corsOrigin.length === 0`
  ไม่มีวันเป็นจริง → dev fallback "allow all" ใช้ไม่ได้

```diff
- corsOrigin: (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim()),
+ corsOrigin: (process.env.CORS_ORIGINS || '')
+   .split(',')
+   .map((origin) => origin.trim())
+   .filter(Boolean),
```

เพิ่มเติม: origin ที่ไม่อนุญาตเดิมตอบ **500** เพราะ callback โยน `Error`
เปลี่ยนเป็น `callback(null, false)` — ปฏิเสธด้วยการไม่ส่ง CORS header
(browser บล็อกเองอยู่แล้ว และ non-browser client ไม่ได้รับผลจาก CORS)

### 2.3 ต่อ database ผิดชื่อตัวแปร (P0)

`database.config.ts` อ่าน `DB_NAME` แต่ Joi และ `data-source.ts` ใช้ `DB_DATABASE`
→ runtime กับ migration CLI ชี้คนละ database ได้ รวมเหลือ `DB_DATABASE` ชุดเดียว

### 2.4 `database.ssl` ไม่เคยถูกกำหนด (P0)

`database.module.ts` เรียก `config.get('database.ssl')` แต่ `database.config.ts`
ไม่ได้ export key `ssl` → เป็น `undefined` → SSL ปิดเงียบเสมอ ทั้งที่ validate `DB_SSL` ไว้

### 2.5 Import ผ่าน physical path เข้า `node_modules` — 9 จุด (P0)

```diff
- import helmet from 'node_modules/helmet/index.mjs';
- import { DocumentBuilder } from 'node_modules/@nestjs/swagger/dist/document-builder';
+ import helmet from 'helmet';
+ import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
```

`dist/main.js` เดิม emit เป็น `require("../node_modules/helmet/index.mjs")` —
CommonJS require ไฟล์ ESM และผูกกับ layout ของ `node_modules` แบบ hoisted
พังทันทีใน Docker multi-stage / pnpm / bundler

ไฟล์ที่แก้: `main.ts`, `app.module.ts`, `health.controller.ts`, `health.module.ts`,
`transform-response.interceptor.ts`

### 2.6 `@SkipTransform()` ไม่ทำงาน (P1)

decorator ตั้ง metadata key `'skipTransform'` แต่ interceptor อ่านด้วย
string literal `'SKIP_TRANSFORM_KEY'` → ไม่มีวันตรงกัน ผลคือ `/health`
ถูกห่อ envelope ทับผลลัพธ์ Terminus

```diff
- this.reflector.getAllAndOverride<boolean>('SKIP_TRANSFORM_KEY', [...])
+ this.reflector.getAllAndOverride<boolean>(SKIP_TRANSFORM_KEY, [...])
```

### 2.7 `|| null` ทำให้ค่า falsy หาย (P1)

`data: payload || null` แปลง `0`, `''`, `false` เป็น `null` ทั้งหมด → `?? null`

### 2.8 Validation error สูญเสียราย field (P1)

filter ยุบ `message: string[]` ของ ValidationPipe เป็น string เดียวด้วย `.join(', ')`
→ frontend ผูก error กับ input field ไม่ได้ เปลี่ยนเป็นจัดกลุ่มราย field:

```json
{ "code": "VALIDATION_ERROR", "errors": { "email": ["email must be an email"] } }
```

### 2.9 Health check ถูก filter กลืน (P1)

Terminus โยน `ServiceUnavailableException` ที่ `getResponse()` เป็น
`{status, info, error, details}` — ไม่มี key `message` → filter คืน
`"Internal server error"` และทิ้งข้อมูลว่า indicator ไหนพัง
ตอนนี้ health document ถูกส่งผ่านตรง ๆ ทั้งตอนผ่าน (200) และตอนล้ม (503)

### 2.10 Health threshold ต่ำเกินไป — เจอเพิ่มระหว่างทาง

`checkRSS('memory_rss', 150 * 1024 * 1024)` — Node process ปกติก็เกิน 150 MB RSS
จะทำให้ probe ล้มและ container ถูก restart วนใน production
เปลี่ยนเป็น env-configurable (`HEALTH_HEAP_MB=512`, `HEALTH_RSS_MB=1024`)

---

## 3. สิ่งที่เพิ่มเข้ามา

### 3.1 Error contract

`src/common/constants/error-code.ts` (ใหม่) + `http-exception.filter.ts`

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

- `code` เป็น enum ที่ client ควรใช้ branch แทนการ match `message`
- `requestId` ตรงกับ header `x-request-id`
- 5xx ที่ไม่ใช่ `HttpException` ถูก mask เป็น `"Internal server error"` เสมอ
  นอก production มี `details` บอก name/message ไว้ debug — production ตัดทิ้ง

### 3.2 Swagger สะท้อน response จริง

- `ApiResponseDto` เปลี่ยนจาก `interface` → `class` พร้อม `@ApiProperty`
  (interface ใส่ decorator ไม่ได้ จึงไม่เคยปรากฏใน OpenAPI)
- เพิ่ม `ApiErrorResponseDto`
- `src/common/decorators/api-response.decorator.ts` (ใหม่):
  `ApiEnvelopeResponse` / `ApiEnvelopeArrayResponse` /
  `ApiEnvelopePaginatedResponse` / `ApiEnvelopeErrorResponse`
- เปิด Swagger CLI plugin ใน `nest-cli.json`

### 3.3 Pagination contract

`PaginationQueryDto` (page/limit/sortBy/sortDirection) + `PaginatedDto` + `paginate()`

### 3.4 Production hardening

- ย้าย filter/interceptor จาก `new ...()` ใน `main.ts` → `APP_FILTER` / `APP_INTERCEPTOR`
  provider เพื่อให้ inject `ConfigService` ได้
- `ThrottlerGuard` เป็น global guard (`/health` ใส่ `@SkipThrottle()`)
- `compression` + body limit 1mb
- `app.enableShutdownHooks()`
- log level แยกตาม env (production ปิด `debug`/`verbose`)
- `setGlobalPrefix(prefix, { exclude: ['health'] })` — probe หา `/health` เจอ

### 3.5 รวม DB config เป็นชุดเดียว

`src/config/typeorm.options.ts` (ใหม่) — `database.module.ts` (runtime) กับ
`data-source.ts` (CLI) เดิมตั้งค่าแยกกันและ drift ไปแล้ว ตอนนี้ใช้ factory เดียวกัน

`data-source.ts` เดิม `import 'dotenv/config'` ซึ่งอ่านแค่ `.env` (ไม่มีอยู่จริง)
→ เปลี่ยนเป็นเลือกไฟล์ตาม `NODE_ENV` เหมือน `AppModule` และประกาศ `dotenv`
ใน `dependencies` (เดิมติดมาแบบ transitive จาก `@nestjs/config`)

### 3.6 ความปลอดภัย

`.gitignore` เดิมมีแค่ `.env` และ `.env.*.local` → `.env.development`
ที่มี `DB_PASSWORD` กำลังจะถูก commit เปลี่ยนเป็น ignore `.env.*` ทั้งหมด
ยกเว้นไฟล์ `.example`

### 3.7 Test

เดิมไม่มี unit test เลย และ e2e ยังเป็น boilerplate ที่ยิง `GET /` คาด
`'Hello World!'` ทั้งที่ `app.controller.ts` ถูกลบไปแล้ว — พังแน่นอน

| ไฟล์ | ครอบคลุม |
| --- | --- |
| `transform-response.interceptor.spec.ts` | envelope, falsy payload, `@SkipTransform`, non-http context |
| `http-exception.filter.spec.ts` | error code, validation grouping, Terminus passthrough, การ mask 5xx |
| `request-id.middleware.spec.ts` | generate / reuse / header ซ้ำ |
| `test/app.e2e-spec.ts` (เขียนใหม่) | routing + prefix, health, request-id, error envelope |

`NODE_ENV=test` ที่ Jest ตั้งให้ ทำให้ Joi ปฏิเสธตอน boot — เพิ่ม `'test'`
เข้า valid list และ fallback ไป `.env.development` เมื่อไม่มี `.env.test`

### 3.8 Infra

- `Dockerfile` (ใหม่) — multi-stage, non-root user `node`, `dumb-init`
  เพื่อให้ SIGTERM ถึง Nest และ `enableShutdownHooks()` ทำงาน
- `docker-compose.yaml` — เพิ่ม `env_file`, healthcheck ของ Postgres,
  service ของ api (อยู่หลัง profile `full`)
- `.dockerignore`, `.env.production.example` (ใหม่)
- `src/openapi.ts` (ใหม่) + `npm run docs:json` — emit `openapi.json` ให้ frontend codegen

### 3.9 tsconfig

`strict: true`, `noImplicitAny: true`, `strictBindCallApply: true`,
`noFallthroughCasesInSwitch: true` (`strictPropertyInitialization: false`
เพราะ DTO class ใช้รูปแบบ declare-only ตามปกติของ Nest)

---

## 4. รายการไฟล์

### 4.1 แก้ไข

| ไฟล์ | แก้อะไร |
| --- | --- |
| `src/config/database.config.ts` | synchronize กลับด้าน, `DB_DATABASE`, เพิ่ม `ssl` |
| `src/config/app.config.ts` | `CORS_ORIGINS` + filter, throttle, health threshold |
| `src/config/env.validation.ts` | `HOST`/`DOCS_TITLE`/`DOCS_VERSION`/throttle/health, `DOCS_ENABLED` เป็น `valid(false)` ใน prod, รับ `NODE_ENV=test` |
| `src/common/dto/api-response.dto.ts` | interface → class + `ApiErrorResponseDto` |
| `src/common/filters/http-exception.filter.ts` | เขียนใหม่ทั้งไฟล์ (error contract) |
| `src/common/interceptors/transform-response.interceptor.ts` | skip key, `?? null`, typing |
| `src/database/database.module.ts` | ใช้ `buildDataSourceOptions()` |
| `src/database/data-source.ts` | โหลด env ตาม `NODE_ENV`, ใช้ factory ร่วม |
| `src/health/health.controller.ts` | import paths, `@SkipTransform`, `@SkipThrottle`, threshold |
| `src/health/health.module.ts` | import path |
| `src/app.module.ts` | throttler, APP_FILTER/INTERCEPTOR/GUARD, envFilePath |
| `src/main.ts` | import paths, CORS, compression, shutdown hooks, prefix exclude |
| `test/app.e2e-spec.ts` | เขียนใหม่ทั้งไฟล์ |
| `nest-cli.json` | เปิด Swagger CLI plugin |
| `tsconfig.json` | strict |
| `package.json` | deps + scripts |
| `.gitignore` | ignore `.env.*`, `openapi.json` |
| `.env.example` / `.env.development` | ตัวแปรชุดเดียว + ตัวใหม่ |
| `docker-compose.yaml` | env_file, healthcheck, api service |
| `README.md` | เขียนใหม่แทน Nest boilerplate |

### 4.2 สร้างใหม่

```
src/common/constants/error-code.ts
src/common/decorators/api-response.decorator.ts
src/common/dto/paginated.dto.ts
src/common/dto/pagination-query.dto.ts
src/common/filters/http-exception.filter.spec.ts
src/common/interceptors/transform-response.interceptor.spec.ts
src/common/middleware/request-id.middleware.spec.ts
src/config/typeorm.options.ts
src/database/migrations/.gitkeep
src/openapi.ts
Dockerfile
.dockerignore
.env.production.example
docs/api-contract-hardening.md   (ไฟล์นี้)
```

### 4.3 ไม่ได้แตะ

`src/config/docs.config.ts`, `src/common/decorators/skip-transform.decorator.ts`,
`src/common/middleware/request-id.middleware.ts` — ถูกต้องอยู่แล้ว

### 4.4 Dependencies

| แพ็กเกจ | เวอร์ชัน | เหตุผล |
| --- | --- | --- |
| `@nestjs/throttler` | ^6.5.0 | rate limiting |
| `compression` | ^1.8.1 | response compression |
| `dotenv` | ^17.4.2 | migration CLI (เดิมใช้แบบ transitive) |
| `@types/compression` (dev) | ^1.8.1 | types |

### 4.5 Scripts ที่เพิ่ม

`lint:ci`, `docs:json`, `db:up`, `db:down`

---

## 5. ผลการตรวจสอบ

| รายการ | ผล |
| --- | --- |
| `npx tsc --noEmit` (strict) | ผ่าน |
| `npx eslint src test` | ผ่าน ไม่มี error/warning |
| `npm test` | 21 passed / 3 suites |
| `npm run test:e2e` | 5 passed / 1 suite |
| `npm run build` | ผ่าน |
| `grep node_modules dist/` | ไม่พบ |
| `npm run migration:run` | อ่าน `.env.development` (25 ตัวแปร), ต่อ DB, สร้างตาราง `migrations` |
| `npm run docs:json` | เขียน `openapi.json` สำเร็จ |
| `GET /health` | `{"status":"ok","details":{"database":{"status":"up"}, ...}}` — ไม่ถูกห่อ envelope |
| `GET /api/v1/health` | 404 (ถูกต้อง — ถูก exclude จาก prefix) |
| `GET /api/v1/does-not-exist` | error envelope ครบ `code`/`timestamp`/`path`/`requestId` |
| CORS `Origin: http://localhost:3000` | ได้ `Access-Control-Allow-Origin` |
| CORS `Origin: http://evil.example.com` | ไม่มี ACAO header, ไม่ 500 |
| `x-request-id: my-trace-123` | echo กลับค่าเดิม |
| `git status` | `.env.development` ไม่ปรากฏแล้ว |

---

## 6. ยังไม่ได้ทำ

| หัวข้อ | หมายเหตุ |
| --- | --- |
| Auth | ตกลงกันว่ายังไม่ทำในรอบนี้ — คง `.addBearerAuth()` ใน Swagger ไว้ก่อน รอทำพร้อม domain module |
| CI config | ยังไม่มี `.github/workflows` |
| เชื่อม contract กับ frontend | `openapi-typescript` codegen + `NEXT_PUBLIC_API_URL` + fetch wrapper |
| `enableVersioning()` | ตอนนี้ version ยังฝังใน global prefix |
| Domain module | ยังไม่มี entity / controller ใด ๆ นอกจาก health |

## 7. ข้อจำกัดของการตรวจสอบ

- **Throttler** ลงทะเบียนเป็น global guard แล้ว แต่ทดสอบ end-to-end ไม่ได้
  เพราะ route เดียวที่มีคือ `/health` ซึ่งใส่ `@SkipThrottle()` ไว้ —
  จะพิสูจน์ได้ตอนมี domain route จริง
- **Dockerfile / docker-compose** ยังไม่ได้ build จริง เพราะเครื่องที่ทดสอบ
  ไม่มี Docker ติดตั้ง — ทดสอบกับ Postgres ที่รันอยู่บนพอร์ต 5432 โดยตรงแทน
- **production boot** ยังไม่ได้ลองจริง เพราะไม่มี `.env.production`
  (มีแต่ `.env.production.example`) — พฤติกรรม production ที่ยืนยันได้
  มาจากการอ่านโค้ดและ Joi schema
