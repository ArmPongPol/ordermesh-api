import { registerAs } from '@nestjs/config';

export default registerAs('docs', () => ({
  enabled: String(process.env.DOCS_ENABLED || 'true') === 'true',
  title: process.env.DOCS_TITLE || 'OrderMesh API',
  description: process.env.DOCS_DESCRIPTION || 'OrderMesh API Documentation',
  version: process.env.DOCS_VERSION || '1.0.0',
  path: process.env.DOCS_PATH || 'docs',
}));
