import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
    globalSetup: ['./test/global-setup.ts'],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://saaserp_app:saaserp_app@localhost:5432/saaserp_test',
      MIGRATION_DATABASE_URL:
        process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://saaserp_owner:saaserp_owner@localhost:5432/saaserp_test',
      JWT_SECRET: 'test-secret',
    },
  },
});
