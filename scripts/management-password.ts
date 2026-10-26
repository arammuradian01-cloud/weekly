// [Codex] После разрешённой выкладки: npm run management-password -- kraynik personal --apply
// Без --apply только проверка. Никаких паролей, хэшей или токенов в аргументах и выводе.
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { managementPasswordPolicy, setManagementPasswordMode } from "../src/lib/login/management-password";

async function main() {
  const [slug, mode, flag, ...extra] = process.argv.slice(2);
  if (!slug || (mode !== "personal" && mode !== "shared") || (flag && flag !== "--apply") || extra.length) {
    throw new Error("Использование: npm run management-password -- <slug> personal|shared [--apply]");
  }
  const person = await prisma.person.findUnique({ where: { slug } });
  if (!person?.active || person.role !== "OWNER") throw new Error("Нужен включённый владелец");
  if (mode === "personal" && (!person.passwordHash || !person.passwordSetAt)) throw new Error("У владельца ещё нет личного пароля");
  const before = await managementPasswordPolicy(person);
  console.log(`${person.fullName}: ${before.broken ? "настройка повреждена" : before.mode} на ${mode}.`);
  if (flag !== "--apply") {
    console.log("Только проверка. Для применения повторите с --apply. Пароли других владельцев не меняются.");
    return;
  }
  const result = await setManagementPasswordMode(slug, mode);
  console.log(result.changed ? "Режим изменён. Этот владелец должен включить управление заново. Пароли не менялись." : "Режим уже настроен, ничего не изменено.");
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Не удалось изменить режим");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
