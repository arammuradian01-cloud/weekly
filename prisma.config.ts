import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // prisma generate работает и без базы, поэтому подставляем заглушку
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/placeholder",
  },
});
