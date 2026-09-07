import * as Joi from 'joi';

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
