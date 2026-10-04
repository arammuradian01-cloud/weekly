import "dotenv/config";
import { defineConfig } from "prisma/config";
import { databaseUrlFromEnv } from "./src/lib/database-url";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // prisma generate работает и без базы, поэтому подставляем заглушку
    url: databaseUrlFromEnv() ?? "postgresql://localhost:5432/placeholder",
  },
});
