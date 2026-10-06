// Личная ссылка для входа из консоли сервера (этап 9): на случай, когда владелец не может войти сам,
// например после выключения общего логина или на новом устройстве без доступа к почте.
//
// npm run login-link -- <короткое имя или почта>
//
// Ссылка действует 3 дня и открывает вход один раз. Прежняя неиспользованная ссылка этого человека гаснет.
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { INVITE_TTL_MS, hashToken, linkUrl, newToken } from "../src/lib/login/service";

async function main() {
  const who = (process.argv[2] ?? "").trim().toLowerCase();
  if (!who) throw new Error("Укажите человека: npm run login-link -- <короткое имя или почта>");
  const person = await prisma.person.findFirst({ where: { OR: [{ slug: who }, { email: who }] } });
  if (!person) throw new Error(`Человек «${who}» не найден. Короткие имена: ${(await prisma.person.findMany({ select: { slug: true } })).map((p) => p.slug).join(", ")}`);
  if (!person.active) throw new Error(`${person.fullName} выключен: сначала включите его в настройках`);

  const now = new Date();
  const token = newToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  await prisma.$transaction(async (tx) => {
    await tx.loginLink.updateMany({ where: { personId: person.id, kind: "INVITE", usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
    await tx.loginLink.create({ data: { tokenHash: hashToken(token), kind: "INVITE", personId: person.id, expiresAt } });
    await tx.auditLog.create({
      data: { action: "auth.invite", source: "SYSTEM", actorName: "Команда на сервере", entity: "person", entityId: person.slug, field: person.fullName, after: "ссылка из консоли сервера" },
    });
  });
  const base = process.env.APP_URL ?? "https://АДРЕС-РЕСУРСА";
  console.log(`Ссылка для входа: ${person.fullName}. Действует 3 дня, один раз:`);
  console.log(linkUrl(base, token));
  if (!process.env.APP_URL) console.log("APP_URL не задан: замените начало ссылки адресом ресурса.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
