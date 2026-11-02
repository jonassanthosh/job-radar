import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['scanner/test/**/*.test.ts'], environment: 'node' } });
