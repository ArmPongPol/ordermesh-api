import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  name: process.env.APP_NAME || 'OrderMesh',
  env: process.env.NODE_ENV || 'development',
  apiPrefix: process.env.API_PREFIX || 'api',
  apiVersion: process.env.API_VERSION || 'v1',
  corsOrigin: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  corsCredentials: process.env.CORS_CREDENTIALS !== 'false',
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || 'localhost',
  throttleTtl: parseInt(process.env.THROTTLE_TTL || '60000', 10),
  throttleLimit: parseInt(process.env.THROTTLE_LIMIT || '120', 10),
  // Megabytes. A Node process routinely sits well above 150 MB RSS, so low
  // thresholds make the health check flap and restart healthy containers.
  healthHeapMb: parseInt(process.env.HEALTH_HEAP_MB || '512', 10),
  healthRssMb: parseInt(process.env.HEALTH_RSS_MB || '1024', 10),
}));
