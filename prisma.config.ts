import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;

if (!databaseUrl) {
  throw new Error(
    "prisma.config.ts: DATABASE_URL is required. Copy .env.example to .env and set it.",
  );
}

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
    ...(directUrl ? { directUrl } : {}),
  },
});