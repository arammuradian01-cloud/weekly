import "dotenv/config";
import { prisma } from "../src/lib/db";
import { dictionaries, people, settings } from "./seed-data";
import { issueSetupCode } from "../src/lib/setup-status";
import { readFileSync } from "node:fs";
import { importBordTasks } from "../src/lib/tasks/bord-import";
import { importBordWeekly } from "../src/lib/weekly/bord-import";
import { BORD_DEFAULT } from "../scripts/lib/bord-source";
import type { DictKind, Prisma } from "../src/generated/prisma/client";

async function main() {
  let order = 0;
  for (const [kind, items] of Object.entries(dictionaries) as [DictKind, (typeof dictionaries)[DictKind]][]) {
    order = 0;
    for (const item of items) {
      order += 10;
      await prisma.dictionaryItem.upsert({
        where: { kind_code: { kind, code: item.code } },
        update: {},
        create: {
          kind,
          code: item.code,
          label: item.label,
          color: item.color ?? null,
          active: item.active ?? true,
          isDefault: item.isDefault ?? false,
          sortOrder: order,
        },
      });
    }
  }

  const directions = await prisma.dictionaryItem.findMany({ where: { kind: "DIRECTION" } });
  const directionId = (code: string) => directions.find((d) => d.code === code)?.id ?? null;

  order = 0;
  for (const p of people) {
    order += 10;
    await prisma.person.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        slug: p.slug,
        fullName: p.fullName,
        shortName: p.shortName,
        role: p.role,
        zone: p.zone,
        defaultDirectionId: directionId(p.direction),
        active: p.active ?? true,
        sortOrder: order,
      },
    });
  }

  await prisma.setting.createMany({
    data: Object.entries(settings).map(([key, value]) => ({
      key,
      value: value as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });

  // Задачи из Insurance&Invest Bord загружаются один раз, в пустую базу. BORD_IMPORT=off отключает
  if (process.env.BORD_IMPORT !== "off" && (await prisma.task.count()) === 0) {
    const report = await importBordTasks(prisma, readFileSync(BORD_DEFAULT.file, "utf8"), { batch: BORD_DEFAULT.batch });
    console.log(`Задачи из Insurance&Invest Bord загружены: ${report.created.length}, следующий номер ${report.nextNumber}`);
  }
  // Weekly из вкладки Weekly CEO: тоже один раз, в пустую базу
  if (process.env.BORD_IMPORT !== "off" && (await prisma.weeklyEntry.count()) === 0) {
    const report = await importBordWeekly(prisma, readFileSync(BORD_DEFAULT.weeklyFile, "utf8"), { batch: BORD_DEFAULT.batch });
    console.log(`Weekly из Insurance&Invest Bord загружен: записей ${report.created}, недели ${report.weeks.join(", ")}`);
  }

  const counts = {
    people: await prisma.person.count(),
    dictionaries: await prisma.dictionaryItem.count(),
    settings: await prisma.setting.count(),
    tasks: await prisma.task.count(),
    entries: await prisma.weeklyEntry.count(),
  };
  console.log(`Стартовые данные на месте: людей ${counts.people}, значений справочников ${counts.dictionaries}, настроек ${counts.settings}, задач ${counts.tasks}, записей weekly ${counts.entries}`);

  // Пока пароли не заданы, при каждом запуске выпускаем новый одноразовый код для страницы /setup
  const code = await issueSetupCode();
  if (code) {
    console.log(`Код первичной настройки: ${code}`);
    console.log("Откройте страницу /setup и введите код вместе с тремя паролями. Код меняется при каждом запуске и гаснет, как только пароли заданы.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
