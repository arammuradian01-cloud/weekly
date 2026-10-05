import "dotenv/config";
import { prisma } from "../src/lib/db";
import { dictionaries, people, settings } from "./seed-data";
import { issueSetupCode } from "../src/lib/setup-status";
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

  const counts = {
    people: await prisma.person.count(),
    dictionaries: await prisma.dictionaryItem.count(),
    settings: await prisma.setting.count(),
  };
  console.log(`Стартовые данные на месте: людей ${counts.people}, значений справочников ${counts.dictionaries}, настроек ${counts.settings}`);

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
