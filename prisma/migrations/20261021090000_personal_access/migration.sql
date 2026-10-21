-- повторяемая: этап 52 (доступы для всей компании). Логин человека вида amuradyan (заполняет сид при запуске),
-- почта, которую человек указал сам и ещё не подтвердил, вид ссылки «подтверждение почты» и адрес, на который она ушла

ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "login" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "people_login_key" ON "people"("login");
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "pendingEmail" TEXT;
ALTER TYPE "LinkKind" ADD VALUE IF NOT EXISTS 'EMAIL_CONFIRM';
ALTER TABLE "login_links" ADD COLUMN IF NOT EXISTS "target" TEXT;
ALTER TYPE "AttemptKind" ADD VALUE IF NOT EXISTS 'EMAIL_BIND';
