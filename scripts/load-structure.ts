// Загрузка структуры департамента из консоли сервера (этап 14). То же самое без консоли: страница «Структура»,
// «Загрузить структуру» у владельца в режиме управления.
//
// npm run structure -- путь/к/файлу.csv [--yes]
//
// Без --yes ничего не меняет: пишет, кто добавится, кто изменится, какие подразделения появятся и выключатся.
// С --yes загружает от имени владельца ресурса. Людей ресурс не выключает и задачи не трогает.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { actorFor } from "../src/lib/tasks/service";
import { applyStructure, previewStructure } from "../src/lib/org/service";

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) throw new Error("Укажите файл: npm run structure -- путь/к/файлу.csv [--yes]");
  const text = readFileSync(file, "utf8");
  const owner = await prisma.person.findFirst({ where: { role: "OWNER", active: true }, orderBy: { sortOrder: "asc" } });
  if (!owner) throw new Error("В ресурсе нет включённого владельца");
  const actor = { ...(await actorFor(owner.slug, "OWNER")), ip: null, via: null };
  const plan = await previewStructure(actor, text);
  console.log(`Людей добавится ${plan.people.add.length}, изменится ${plan.people.change.length}, без изменений ${plan.people.same}`);
  console.log(`Подразделений новых ${plan.units.add.length}, выключится ${plan.units.remove.length}, вакансий ${plan.vacancies.length}`);
  for (const p of plan.problems) console.log(`Строка ${p.line}: ${p.text}`);
  if (plan.problems.length) throw new Error("В файле есть ошибки: исправьте и запустите снова");
  if (!process.argv.includes("--yes")) {
    console.log("Ничего не изменено. Чтобы загрузить, добавьте --yes");
    return;
  }
  const r = await applyStructure(actor, text);
  console.log(`Загружено: новых людей ${r.added}, изменено ${r.changed}, подразделений ${r.units}, команд ${r.teams}, участников добавлено ${r.members}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
