-- Этап 9: личные входы по одноразовой ссылке, устройства, способ входа в журнале, отсутствие с замещающим.

-- CreateEnum
CREATE TYPE "LoginMethod" AS ENUM ('TEAM', 'EMAIL', 'INVITE');

-- CreateEnum
CREATE TYPE "LinkKind" AS ENUM ('EMAIL', 'INVITE', 'STEP_UP');

-- AlterEnum
ALTER TYPE "AttemptKind" ADD VALUE 'LINK';

-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "via" "LoginMethod";

-- CreateTable
CREATE TABLE "login_links" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" "LinkKind" NOT NULL,
    "personId" TEXT NOT NULL,
    "createdById" TEXT,
    "deviceId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "usedIp" TEXT,

    CONSTRAINT "login_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_sessions" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "method" "LoginMethod" NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedBy" TEXT,

    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absences" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "substituteId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "login_links_tokenHash_key" ON "login_links"("tokenHash");

-- CreateIndex
CREATE INDEX "login_links_personId_kind_idx" ON "login_links"("personId", "kind");

-- CreateIndex
CREATE INDEX "device_sessions_personId_idx" ON "device_sessions"("personId");

-- CreateIndex
CREATE INDEX "absences_weekId_idx" ON "absences"("weekId");

-- CreateIndex
CREATE UNIQUE INDEX "absences_personId_weekId_key" ON "absences"("personId", "weekId");

-- AddForeignKey
ALTER TABLE "login_links" ADD CONSTRAINT "login_links_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absences" ADD CONSTRAINT "absences_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absences" ADD CONSTRAINT "absences_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absences" ADD CONSTRAINT "absences_substituteId_fkey" FOREIGN KEY ("substituteId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Замещающий не может быть самим отсутствующим, почта хранится в нижнем регистре
ALTER TABLE "absences" ADD CONSTRAINT "absences_substitute_check" CHECK ("substituteId" IS NULL OR "substituteId" <> "personId");
ALTER TABLE "people" ADD CONSTRAINT "people_email_check" CHECK ("email" IS NULL OR ("email" = lower("email") AND "email" LIKE '%_@_%'));
