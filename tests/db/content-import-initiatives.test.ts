// Этап 67г: крупные инициативы в пакете наполнения и деление страницы инициатив по департаментам и продуктам.
// Предпросмотр ничего не пишет; загрузка ставит инициативы с продуктом, ответственным, делением, заметкой и итогом,
// без событий «Мне»; повтор ничего не меняет; правка в ресурсе не затирается следующей загрузкой; кадровые сведения,
// неизвестный продукт и неизвестный человек не грузятся; похожая открытая инициатива считается дублем; больше 15
// открытых даёт предупреждение. Страница: продукт и департамент у инициативы, руководитель направления для формы.
// Люди и продукты из сида тестовой базы, тексты вымышленные
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as ini from "@/lib/initiatives/service";
import { parsePackage, type ContentPackage } from "@/lib/content-import/package";
import { applyContentImport, previewContentImport } from "@/lib/content-import/service";
import { TOP_TEAM } from "@/lib/org/scope";

const owner = async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("muradyan", "OWNER")), via: "PASSWORD" });
const idOf = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;
const nameOf = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).fullName;
const texts = (lines: { what: string; text: string }[]) => lines.map((n) => `${n.what}: ${n.text}`).join("\n");

type Item = Record<string, unknown>;
const pkgOf = (initiatives: Item[], extra: Record<string, unknown> = {}): ContentPackage => {
  const { pkg, problems } = parsePackage(JSON.stringify({ format: "weekly-napolnenie/1", title: "Инициативы для теста", initiatives, ...extra }));
  expect(problems).toEqual([]);
  return pkg;
};
const byKey = async (key: string) => {
  const k = await prisma.contentImportKey.findUnique({ where: { kind_key: { kind: "initiative", key } } });
  return k ? prisma.initiative.findUniqueOrThrow({ where: { id: k.entityId }, include: { direction: true, changes: { orderBy: { at: "asc" } } } }) : null;
};

async function base(): Promise<Item[]> {
  return [
    { key: "ini.osago.sub", title: "Подписка на полис с другими страховыми", why: "Клиент платит частями", direction: "osago", owner: await nameOf("golovkin"), state: "doing", note: "Пилот с одной страховой" },
    { key: "ini.all.wallet", title: "Кошелёк и кэшбэк", why: "Деньги клиента остаются у нас", owner: await nameOf("muradyan"), state: "searching" },
    { key: "ini.dep.cjm", title: "Путь клиента по вкладам", direction: "deposits", owner: await nameOf("cheychenets"), state: "done", result: "Форма заявки в пути клиента сделана" },
  ];
}

async function reset() {
  await prisma.contentImportKey.deleteMany();
  await prisma.task.updateMany({ data: { goalId: null } });
  await prisma.initiative.updateMany({ data: { goalId: null } });
  await prisma.goal.deleteMany({ where: { code: { in: ["ТИ-1", "ТИ-2"] } } });
  await prisma.decisionTask.deleteMany();
  await prisma.decision.deleteMany();
  await prisma.agendaItem.deleteMany({ where: { initiativeId: { not: null } } });
  await prisma.initiative.deleteMany();
  await prisma.inboxEvent.deleteMany({ where: { kind: "INITIATIVE" } });
}

beforeEach(reset);
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

describe("загрузка инициатив", () => {
  it("предпросмотр ничего не пишет, загрузка ставит инициативы с продуктом, делением и итогом, без событий «Мне»", async () => {
    const pkg = pkgOf(await base());
    const preview = await previewContentImport(await owner(), pkg);
    expect(preview.initiatives).toEqual({ add: 3, update: 0, skip: 0 });
    expect(preview.errors).toEqual([]);
    expect(await prisma.initiative.count()).toBe(0);

    const before = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    const res = await applyContentImport(await owner(), pkg);
    expect(res.applied.initiatives).toBe(3);
    const sub = (await byKey("ini.osago.sub"))!;
    expect(sub).toMatchObject({ state: "DOING", note: "Пилот с одной страховой", teamId: TOP_TEAM, ownerId: await idOf("golovkin"), closedAt: null });
    expect(sub.direction?.code).toBe("osago");
    expect(sub.changes.map((c) => c.kind)).toEqual(["create"]);
    const wallet = (await byKey("ini.all.wallet"))!;
    expect(wallet).toMatchObject({ state: "SEARCHING", directionId: null, note: "" });
    const cjm = (await byKey("ini.dep.cjm"))!;
    expect(cjm).toMatchObject({ result: "DONE", resultNote: "Форма заявки в пути клиента сделана" });
    expect(cjm.closedAt).not.toBeNull();
    expect(cjm.changes.map((c) => c.kind)).toEqual(["create", "close"]);
    // Ответственных назначили в рабочем файле, а не сегодня: событий о загруженных инициативах нет
    expect(await prisma.inboxEvent.count({ where: { kind: "INITIATIVE" } })).toBe(0);
    const log = await prisma.auditLog.findMany({ where: { id: { gt: before } }, orderBy: { id: "asc" } });
    expect(log.filter((l) => l.action === "initiative.create")).toHaveLength(3);
    expect(log.find((l) => l.action === "content.import")?.after).toMatch(/Инициативы: новых 3, обновлено 0, пропущено 0/);

    // Повтор того же пакета ничего не меняет
    const again = await previewContentImport(await owner(), pkg);
    expect(again.initiatives).toEqual({ add: 0, update: 0, skip: 3 });
    await applyContentImport(await owner(), pkg);
    expect(await prisma.initiative.count()).toBe(3);
  });

  it("пакет поменял заметку и деление: пишется; название правили в ресурсе: загрузка его не трогает и потом", async () => {
    const items = await base();
    await applyContentImport(await owner(), pkgOf(items));
    const sub = (await byKey("ini.osago.sub"))!;
    await prisma.initiative.update({ where: { id: sub.id }, data: { title: "Подписка ОСАГО: своё название" } });

    items[0] = { ...items[0], title: "Подписка: новое название из пакета", note: "Подключаем вторую страховую" };
    items[1] = { ...items[1], state: "doing", note: "Считаем экономику" };
    items[2] = { ...items[2], state: "searching", result: null };
    const pkg = pkgOf(items);
    const preview = await previewContentImport(await owner(), pkg);
    expect(preview.initiatives).toEqual({ add: 0, update: 3, skip: 0 });
    expect(texts(preview.notes)).toMatch(/поле «Инициатива» правили в ресурсе/);
    await applyContentImport(await owner(), pkg);

    const after = (await byKey("ini.osago.sub"))!;
    expect(after.title).toBe("Подписка ОСАГО: своё название");
    expect(after.note).toBe("Подключаем вторую страховую");
    const wallet = (await byKey("ini.all.wallet"))!;
    expect(wallet).toMatchObject({ state: "DOING", note: "Считаем экономику" });
    expect(wallet.changes.map((c) => c.kind)).toEqual(["create", "note", "state"]);
    // Закрытая в пакете стала открытой: инициатива возвращается в работу
    const cjm = (await byKey("ini.dep.cjm"))!;
    expect(cjm).toMatchObject({ closedAt: null, result: null, state: "SEARCHING" });

    // Следующая загрузка с другим названием правку в ресурсе тоже не затирает
    items[0] = { ...items[0], title: "Подписка: третье название" };
    await applyContentImport(await owner(), pkgOf(items));
    expect((await byKey("ini.osago.sub"))!.title).toBe("Подписка ОСАГО: своё название");
  });

  it("цель и итог, поменянные в ресурсе, загрузка не трогает; пустая заметка пакета не стирает заметку", async () => {
    const goal = { key: "goal.ini.1", quarter: "2026-Q4", team: "top", owner: "Мурадян Арам", code: "ТИ-1", title: "Цель для инициатив" };
    const items = await base();
    items[0] = { ...items[0], goal: { key: "goal.ini.1" } };
    await applyContentImport(await owner(), pkgOf(items, { goals: [goal] }));
    const sub = (await byKey("ini.osago.sub"))!;
    const goalId = sub.goalId!;
    expect(goalId).toBeTruthy();
    // В ресурсе цель сняли, итог закрытой поправили, заметку написали
    await prisma.initiative.update({ where: { id: sub.id }, data: { goalId: null, note: "Своя заметка" } });
    const cjm = (await byKey("ini.dep.cjm"))!;
    await prisma.initiative.update({ where: { id: cjm.id }, data: { resultNote: "Итог поправили в ресурсе" } });

    items[0] = { ...items[0], title: "Подписка: другое название", note: undefined };
    items[2] = { ...items[2], state: "doing", result: undefined };
    const preview = await previewContentImport(await owner(), pkgOf(items, { goals: [goal] }));
    expect(texts(preview.notes)).toMatch(/итог закрытой инициативы правили в ресурсе: загрузка её не открывает/);
    await applyContentImport(await owner(), pkgOf(items, { goals: [goal] }));
    const after = (await byKey("ini.osago.sub"))!;
    expect(after).toMatchObject({ title: "Подписка: другое название", goalId: null, note: "Своя заметка" });
    expect((await byKey("ini.dep.cjm"))!).toMatchObject({ resultNote: "Итог поправили в ресурсе", result: "DONE" });
    expect((await byKey("ini.dep.cjm"))!.closedAt).not.toBeNull();
  });

  it("пакет ставит новую цель пакета, а цель в ресурсе уже поменяли: загрузка её не трогает", async () => {
    const items = await base();
    await applyContentImport(await owner(), pkgOf(items));
    const own = await prisma.goal.create({ data: { quarter: "2026-Q4", teamId: TOP_TEAM, title: "Цель, поставленная руками", code: "ТИ-1" } });
    const sub = (await byKey("ini.osago.sub"))!;
    await prisma.initiative.update({ where: { id: sub.id }, data: { goalId: own.id } });
    items[0] = { ...items[0], goal: { key: "goal.ini.2" } };
    const goals = [{ key: "goal.ini.2", quarter: "2026-Q4", team: "top", owner: "Мурадян Арам", code: "ТИ-2", title: "Новая цель пакета" }];
    const preview = await previewContentImport(await owner(), pkgOf(items, { goals }));
    expect(texts(preview.notes)).toMatch(/поле «Цель» правили в ресурсе/);
    await applyContentImport(await owner(), pkgOf(items, { goals }));
    expect((await byKey("ini.osago.sub"))!.goalId).toBe(own.id);
    await prisma.initiative.update({ where: { id: sub.id }, data: { goalId: null } });
    await prisma.goal.deleteMany({ where: { code: { in: ["ТИ-1", "ТИ-2"] } } });
  });

  it("кадровые сведения, неизвестный продукт и человек не грузятся; итог закрытой обязателен", async () => {
    const pkg = pkgOf([
      { key: "ini.hr", title: "Пересмотр окладов команды продаж", owner: await nameOf("reva") },
      { key: "ini.dir", title: "Новый продукт", direction: "space", owner: await nameOf("reva") },
      { key: "ini.who", title: "Кто-то другой", owner: "Иванов Несуществующий" },
      { key: "ini.ok", title: "Рейтинг станций ремонта", owner: await nameOf("reva"), direction: "osago" },
    ]);
    const preview = await previewContentImport(await owner(), pkg);
    expect(preview.initiatives).toEqual({ add: 1, update: 0, skip: 3 });
    expect(texts(preview.errors)).toMatch(/Инициатива 1 в пакете \(ключ ini\.hr\): кадровые сведения в поле «Название»/);
    expect(texts(preview.errors)).toMatch(/продукта «space» нет в справочнике/);
    expect(preview.missingPeople).toContain("Иванов Несуществующий");
    await applyContentImport(await owner(), pkg);
    expect(await prisma.initiative.count()).toBe(1);

    const { problems } = parsePackage(JSON.stringify({ format: "weekly-napolnenie/1", initiatives: [{ key: "ini.x", title: "Без итога", owner: "Рева Тарас", state: "done" }] }));
    expect(problems.join("\n")).toMatch(/для закрытой инициативы нужен итог/);
  });

  it("похожая открытая инициатива в ресурсе: дубль пропускается, выбранный загружается", async () => {
    await ini.createInitiative(await owner(), { title: "Кошелёк и кэшбэк", owner: "muradyan" });
    const pkg = pkgOf(await base());
    const preview = await previewContentImport(await owner(), pkg);
    expect(preview.initiatives).toEqual({ add: 2, update: 0, skip: 1 });
    expect(preview.duplicates.map((d) => d.id)).toEqual(["initiative/ini.all.wallet"]);
    await applyContentImport(await owner(), pkg, { duplicateKeys: ["initiative/ini.all.wallet"] });
    expect(await prisma.initiative.count({ where: { title: "Кошелёк и кэшбэк" } })).toBe(2);
  });

  it("больше 15 открытых: предупреждение в предпросмотре, загрузка всё равно идёт", async () => {
    const reva = await nameOf("reva");
    const many = Array.from({ length: 16 }, (_, i) => ({ key: `ini.many.${i + 1}`, title: `Инициатива номер ${i + 1}`, owner: reva }));
    const preview = await previewContentImport(await owner(), pkgOf(many));
    expect(texts(preview.warnings)).toMatch(/открытых станет 16, а шкала задумана для 15/);
    await applyContentImport(await owner(), pkgOf(many));
    expect(await prisma.initiative.count()).toBe(16);
  });
});

describe("стирание решений", () => {
  const dec = (key: string, text: string) => ({ key, text, date: "2026-10-12", team: "top", owner: "Мурадян Арам" });
  it("стирает только решения, которые ставила загрузка, с записью в журнале; правленное в ресурсе не стирает", async () => {
    await applyContentImport(await owner(), pkgOf([], { decisions: [dec("dec.keep", "Договорились о пилоте"), dec("dec.drop", "Старое решение встречи"), dec("dec.edit", "Решение, которое потом правили")] }));
    const edited = await prisma.contentImportKey.findUniqueOrThrow({ where: { kind_key: { kind: "decision", key: "dec.edit" } } });
    await prisma.decision.update({ where: { id: edited.entityId }, data: { text: "Правка в ресурсе" } });
    const dropId = (await prisma.contentImportKey.findUniqueOrThrow({ where: { kind_key: { kind: "decision", key: "dec.drop" } } })).entityId;

    const pkg = pkgOf([], { decisions: [dec("dec.keep", "Договорились о пилоте")], remove: [{ kind: "decision", key: "dec.drop" }, { kind: "decision", key: "dec.edit" }, { kind: "decision", key: "dec.never" }] });
    const preview = await previewContentImport(await owner(), pkg);
    expect(preview.removals).toEqual({ remove: 1, skip: 2 });
    expect(texts(preview.warnings)).toMatch(/текст решения правили в ресурсе, загрузка его не стирает/);
    expect(texts(preview.notes)).toMatch(/Стереть решение dec\.never: этого решения загрузка не ставила/);
    expect(await prisma.decision.count()).toBe(3);

    const before = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    const res = await applyContentImport(await owner(), pkg);
    expect(res.applied.removed).toBe(1);
    expect(await prisma.decision.findUnique({ where: { id: dropId } })).toBeNull();
    expect(await prisma.decision.count()).toBe(2);
    expect(await prisma.contentImportKey.findUnique({ where: { kind_key: { kind: "decision", key: "dec.drop" } } })).toBeNull();
    const log = await prisma.auditLog.findMany({ where: { id: { gt: before } } });
    expect(log.find((l) => l.action === "decision.delete")).toMatchObject({ entityId: dropId, before: "Старое решение встречи" });
    expect(log.find((l) => l.action === "content.import")?.after).toMatch(/Стёрто решений: 1, пропущено 2/);

    // Повтор: стирать больше нечего
    expect((await previewContentImport(await owner(), pkg)).removals).toEqual({ remove: 0, skip: 3 });
    const { problems } = parsePackage(JSON.stringify({ format: "weekly-napolnenie/1", decisions: [dec("dec.keep", "А")], remove: [{ kind: "decision", key: "dec.keep" }, { kind: "task", key: "task.x" }] }));
    expect(problems.join("\n")).toMatch(/и загружается, и стирается/);
    expect(problems.join("\n")).toMatch(/стереть можно только решения/);
  });
});

describe("weekly для CEO за прошедшие недели", () => {
  const W1 = "2026-09-07";
  const W2 = "2026-09-14";
  const report = (key: string, week: string, extra = "") => ({
    key,
    week,
    blocks: [
      { key: "news", lines: [{ text: `Собрали структуру разработки${extra}` }] },
      { key: "wow", lines: [{ text: "Трафик 465 тыс., минус 2%", product: "osago" }] },
      { key: "nope", lines: [{ text: "Блок, которого нет" }] },
      { key: "risks", lines: [{ text: "Вклады ниже бюджета", product: "deposits" }] },
    ],
    meetings: [{ title: "Встреча по вкладам", text: "Договорились о целевой модели" }],
  });
  const weekOf = (start: string) => prisma.week.findUnique({ where: { start: new Date(`${start}T00:00:00Z`) }, include: { ceoReport: true } });
  const cleanCeo = async () => {
    await prisma.ceoReport.deleteMany({ where: { week: { start: { in: [new Date(`${W1}T00:00:00Z`), new Date(`${W2}T00:00:00Z`)] } } } });
  };

  it("ставит отчёт блоками и встречами, правленый в ресурсе и чужой не трогает, будущую неделю не берёт", async () => {
    await cleanCeo();
    try {
      // Отчёт за вторую неделю уже написан в ресурсе руками
      const w2 = await prisma.week.upsert({ where: { start: new Date(`${W2}T00:00:00Z`) }, update: {}, create: { start: new Date(`${W2}T00:00:00Z`), isoYear: 2026, isoNumber: 38, deadline: new Date(`${W2}T15:00:00Z`), meetingDate: new Date(`${W2}T00:00:00Z`) } });
      await prisma.ceoReport.create({ data: { weekId: w2.id, main: "Своё главное" } });
      const pkg = pkgOf([], { ceoReports: [report("ceo.w37", W1), report("ceo.w38", W2), report("ceo.future", "2030-01-07")] });
      const preview = await previewContentImport(await owner(), pkg);
      expect(preview.ceoReports).toEqual({ add: 1, update: 0, skip: 2 });
      expect(texts(preview.warnings)).toMatch(/отчёт за эту неделю уже есть в ресурсе/);
      expect(texts(preview.errors)).toMatch(/неделя ещё не закончилась/);
      expect(texts(preview.notes)).toMatch(/блоков nope в отчёте CEO нет/);

      const res = await applyContentImport(await owner(), pkg);
      expect(res.applied.ceoReports).toBe(1);
      const r1 = (await weekOf(W1))!.ceoReport!;
      const blocks = r1.blocks as { key: string; edited?: boolean; lines: { text: string; product: string | null }[] }[];
      expect(blocks.map((b) => b.key)).toEqual(["news", "wow", "risks"]);
      expect(blocks.every((b) => b.edited)).toBe(true);
      expect(blocks.every((b) => (b as { basis?: string }).basis === "import")).toBe(true);
      expect(blocks[1]!.lines[0]).toMatchObject({ text: "Трафик 465 тыс., минус 2%", product: "osago" });
      expect(r1.main).toMatch(/Собрали структуру разработки/);
      expect(r1.risks).toMatch(/Вклады ниже бюджета/);
      expect(r1.meetings).toEqual([{ title: "Встреча по вкладам", text: "Договорились о целевой модели" }]);
      expect((await weekOf(W2))!.ceoReport!.main).toBe("Своё главное");

      // Повтор ничего не меняет; новая версия пакета обновляет; правку в ресурсе следующая загрузка не затирает
      expect((await previewContentImport(await owner(), pkg)).ceoReports).toEqual({ add: 0, update: 0, skip: 3 });
      const v2 = pkgOf([], { ceoReports: [report("ceo.w37", W1, " и команд")] });
      expect((await previewContentImport(await owner(), v2)).ceoReports).toEqual({ add: 0, update: 1, skip: 0 });
      await applyContentImport(await owner(), v2);
      expect((await weekOf(W1))!.ceoReport!.main).toMatch(/Собрали структуру разработки и команд/);
      await prisma.ceoReport.update({ where: { id: r1.id }, data: { meetings: [{ title: "Правка", text: "Своя" }] } });
      const v3 = pkgOf([], { ceoReports: [report("ceo.w37", W1, " третий раз")] });
      const p3 = await previewContentImport(await owner(), v3);
      expect(p3.ceoReports).toEqual({ add: 0, update: 0, skip: 1 });
      expect(texts(p3.warnings)).toMatch(/отчёт правили в ресурсе после загрузки/);
      // Отправленный CEO отчёт не трогается
      await prisma.ceoReport.update({ where: { id: r1.id }, data: { sentAt: new Date() } });
      expect(texts((await previewContentImport(await owner(), v3)).notes)).toMatch(/уже отправлен CEO/);
    } finally {
      await cleanCeo();
    }
  });
});

describe("страница инициатив", () => {
  it("у инициативы продукт и департамент: подразделение команды, иначе ответственного; руководитель направления для формы", async () => {
    const dep = await prisma.orgUnit.create({ data: { name: "Департамент для теста", kind: "DEPARTMENT" } });
    const div = await prisma.orgUnit.create({ data: { name: "Отдел для теста", kind: "DIVISION", parentId: dep.id } });
    try {
      await prisma.team.update({ where: { id: TOP_TEAM }, data: { unitId: div.id } });
      await applyContentImport(await owner(), pkgOf(await base()));
      const page = await ini.listInitiatives(await owner());
      const sub = page.active.find((i) => i.title.startsWith("Подписка"))!;
      expect(sub.direction).toEqual({ code: "osago", label: expect.any(String) });
      expect(sub.department).toEqual({ id: dep.id, name: "Департамент для теста" });
      expect(page.active.find((i) => i.title === "Кошелёк и кэшбэк")!.direction).toBeNull();
      expect(page.directions.find((d) => d.code === "osago")?.head).toBe("golovkin");
      expect(page.directions.find((d) => d.code === "deposits")?.head).toBe("cheychenets");

      // Продукт ставят и меняют в форме; без поля продукта правка его не трогает
      const { id } = await ini.createInitiative(await owner(), { title: "Скоринг в выдаче", owner: "loginova", direction: "red" });
      expect((await prisma.initiative.findUniqueOrThrow({ where: { id }, include: { direction: true } })).direction?.code).toBe("red");
      await ini.editInitiative(await owner(), id, { title: "Скоринг в выдаче", owner: "loginova" });
      expect((await prisma.initiative.findUniqueOrThrow({ where: { id }, include: { direction: true } })).direction?.code).toBe("red");
      await ini.editInitiative(await owner(), id, { title: "Скоринг в выдаче", owner: "loginova", direction: "" });
      expect((await prisma.initiative.findUniqueOrThrow({ where: { id } })).directionId).toBeNull();
      await expect(ini.createInitiative(await owner(), { title: "Космос", owner: "reva", direction: "space" })).rejects.toThrow(/продукта нет/);
    } finally {
      await prisma.team.update({ where: { id: TOP_TEAM }, data: { unitId: null } });
      await prisma.orgUnit.delete({ where: { id: div.id } });
      await prisma.orgUnit.delete({ where: { id: dep.id } });
    }
  });
});
