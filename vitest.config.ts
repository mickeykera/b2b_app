import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": path.resolve(root, "tests/mocks/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        "postgresql://relayflow:relayflow@localhost:5432/relayflow?sslmode=disable",
      REDIS_URL: "redis://localhost:6379",
      MASTER_ENCRYPTION_KEY: "test-master-encryption-key-0123456789abcdef",
      AUTH_JWT_SECRET: "test-auth-jwt-secret-0123456789abcdef",
      APP_BASE_URL: "http://localhost:3000",
      APP_NAME: "RelayFlow Test",
    },
  },
});