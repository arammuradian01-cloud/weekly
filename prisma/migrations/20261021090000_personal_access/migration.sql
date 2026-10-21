-- повторяемая: этап 52 (доступы для всей компании). Логин человека вида amuradyan (заполняет сид при запуске),
-- почта, которую человек указал сам и ещё не подтвердил, и вид ссылки «подтверждение почты»

ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "login" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "people_login_key" ON "people"("login");
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "pendingEmail" TEXT;
ALTER TYPE "LinkKind" ADD VALUE IF NOT EXISTS 'EMAIL_CONFIRM';
