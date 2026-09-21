import * as Joi from 'joi';
import { JWT_SECRET_PLACEHOLDER } from './auth.config';

export const envValidationSchema = Joi.object({
  APP_NAME: Joi.string().required(),
  // `test` is set automatically by Jest.
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'local', 'test')
    .required(),
  PORT: Joi.number().port().required(),
  HOST: Joi.string().default('localhost'),
  API_PREFIX: Joi.string().default('api'),
  API_VERSION: Joi.string().default('v1'),

  CORS_ORIGINS: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  CORS_CREDENTIALS: Joi.boolean().truthy('true').falsy('false').default(true),

  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_DATABASE: Joi.string().required(),
  DB_SYNCHRONIZE: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().valid(false).default(false),
    otherwise: Joi.boolean().truthy('true').falsy('false').default(false),
  }),
  DB_LOGGING: Joi.boolean().truthy('true').falsy('false').default(false),
  DB_SSL: Joi.boolean().truthy('true').falsy('false').default(false),

  THROTTLE_TTL: Joi.number().default(60000),
  THROTTLE_LIMIT: Joi.number().default(120),

  // ---------------------------------------------------------------------
  // Authentication (JWT + RBAC)
  // ---------------------------------------------------------------------
  // Required in EVERY environment with no default: a defaulted signing key is
  // a backdoor, and the app should refuse to boot rather than sign tokens with
  // a value an attacker can read in the source.
  JWT_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    // 48 chars ~ 256 bits of base64. `.invalid()` stops the .env.example
    // placeholder from reaching production by copy-paste, the same shape of
    // guard DB_SYNCHRONIZE and DOCS_ENABLED already use.
    then: Joi.string().min(48).required().invalid(JWT_SECRET_PLACEHOLDER),
    otherwise: Joi.string().min(32).required(),
  }),
  JWT_ISSUER: Joi.string().default('ordermesh-api'),
  JWT_AUDIENCE: Joi.string().default('ordermesh-web'),
  // Capped at an hour in production: the access token cannot be revoked, so its
  // lifetime is the worst-case window for a stolen one.
  JWT_ACCESS_TTL_SECONDS: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.number().integer().min(60).max(3600).default(900),
    otherwise: Joi.number().integer().min(1).default(900),
  }),

  AUTH_REFRESH_TTL_DAYS: Joi.number().integer().min(1).max(365).default(30),
  // The family cap must not be shorter than one token's own lifetime, or every
  // issued token would violate refresh_tokens_expiry_order_check.
  AUTH_REFRESH_ABSOLUTE_TTL_DAYS: Joi.number()
    .integer()
    .min(Joi.ref('AUTH_REFRESH_TTL_DAYS'))
    .max(365)
    .default(90),

  AUTH_PERMISSION_CACHE_TTL_MS: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.number().integer().min(0).max(300000).default(30000),
    // 0 outside production so tests and local work see role changes instantly.
    otherwise: Joi.number().integer().min(0).max(300000).default(0),
  }),

  AUTH_LOGIN_THROTTLE_LIMIT: Joi.number().integer().min(1).max(100).default(5),
  AUTH_LOGIN_THROTTLE_TTL: Joi.number().integer().min(1000).default(60000),
  AUTH_LOGIN_BLOCK_MS: Joi.number().integer().min(0).default(900000),

  // Consumed only by `npm run seed:admin`, never by the running app.
  // `tlds: false` because the bootstrap admin often lives on an internal
  // domain (admin@ordermesh.local, or a company intranet host) that Joi's
  // default TLD list rejects.
  BOOTSTRAP_ADMIN_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .allow('')
    .optional(),
  BOOTSTRAP_ADMIN_PASSWORD: Joi.string().min(12).max(128).allow('').optional(),

  HEALTH_HEAP_MB: Joi.number().default(512),
  HEALTH_RSS_MB: Joi.number().default(1024),

  DOCS_ENABLED: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean()
      .truthy('true')
      .falsy('false')
      .valid(false)
      .default(false),
    otherwise: Joi.boolean().truthy('true').falsy('false').default(true),
  }),
  DOCS_PATH: Joi.string().default('docs'),
  DOCS_TITLE: Joi.string().default('OrderMesh API'),
  DOCS_DESCRIPTION: Joi.string().allow('').default(''),
  DOCS_VERSION: Joi.string().default('1.0.0'),
});
