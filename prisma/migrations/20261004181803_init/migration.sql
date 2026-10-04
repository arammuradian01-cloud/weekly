-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'LEADER', 'OBSERVER');

-- CreateEnum
CREATE TYPE "DictKind" AS ENUM ('DIRECTION', 'WEEKLY_BLOCK', 'ENTRY_TYPE', 'TASK_STATUS', 'PRIORITY', 'TASK_STATE', 'WEEKLY_STATE', 'TASK_SOURCE');

-- CreateEnum
CREATE TYPE "ChangeSource" AS ENUM ('APP', 'SHEET', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AttemptKind" AS ENUM ('TEAM', 'MANAGEMENT');

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'LEADER',
    "zone" TEXT NOT NULL,
    "defaultDirectionId" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dictionary_items" (
    "id" TEXT NOT NULL,
    "kind" "DictKind" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "dictionary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT,
    "source" "ChangeSource" NOT NULL DEFAULT 'APP',
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "field" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT NOT NULL,
    "kind" "AttemptKind" NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "people_slug_key" ON "people"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "people_email_key" ON "people"("email");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_items_kind_code_key" ON "dictionary_items"("kind", "code");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- CreateIndex
CREATE INDEX "audit_log_entity_entityId_idx" ON "audit_log"("entity", "entityId");

-- CreateIndex
CREATE INDEX "login_attempts_ip_kind_at_idx" ON "login_attempts"("ip", "kind", "at");

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_defaultDirectionId_fkey" FOREIGN KEY ("defaultDirectionId") REFERENCES "dictionary_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
