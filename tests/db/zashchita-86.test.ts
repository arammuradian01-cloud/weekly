// Этап 86: защита и наблюдение на настоящей базе.
// - сбор сбоев: одинаковые складываются в одну запись со счётчиком, старые уходят сами;
// - проверка здоровья отмечает время удачной проверки;
// - режим управления: счёт неверных попыток и по адресу, и по человеку (этап 29 считал только по адресу).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { KEEP_DAYS, errorTotals, recentErrors, recordError } from "@/lib/errors";
import { HEALTH_OK_KEY, checkHealth, healthMarks } from "@/lib/health";
import { MAX_FAILURES } from "@/lib/rate-limit";
import { reserveManagementAttempt } from "@/lib/login/attempts";
import { actorFor, createTask } from "@/lib/tasks/service";
import { loadDepartmentGate } from "@/lib/sheet/department";
import { taskRows } from "@/lib/sheet/rows";

beforeEach(async () => {
  await prisma.errorEvent.deleteMany();
  await prisma.loginAttempt.deleteMany();
  await prisma.setting.deleteMany({ where: { key: { startsWith: "health." } } });
});
afterAll(() => prisma.$disconnect());

describe("сбор сбоев", () => {
  it("одинаковые сбои складываются в одну запись со счётчиком", async () => {
    const at = new Date("2026-11-01T10:00:00Z");
    await recordError({ source: "SERVER", message: "Нет связи с базой", place: "/tasks", stack: "db.ts:10" }, at);
    await recordError({ source: "SERVER", message: "Нет связи с базой", place: "/tasks", stack: "db.ts:10" }, new Date(at.getTime() + 60_000));
    const rows = await recentErrors();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "SERVER", sourceLabel: "Сервер", message: "Нет связи с базой", place: "/tasks", times: 2 });
    // Первый раз остался прежним, последний обновился
    expect(new Date(rows[0].firstAt).getTime()).toBe(at.getTime());
    expect(new Date(rows[0].lastAt).getTime()).toBe(at.getTime() + 60_000);
  });

  it("тот же сбой с другими числами ложится в ту же запись, другой источник — в свою", async () => {
    const at = new Date("2026-11-01T10:00:00Z");
    await recordError({ source: "SERVER", message: "Задача 412 не найдена", place: "/tasks/412" }, at);
    await recordError({ source: "SERVER", message: "Задача 907 не найдена", place: "/tasks/907" }, at);
    await recordError({ source: "BROWSER", message: "Задача 412 не найдена", place: "/tasks/412" }, at);
    const rows = await recentErrors();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source).sort()).toEqual(["BROWSER", "SERVER"]);
    expect(rows.find((r) => r.source === "SERVER")!.times).toBe(2);
  });

  it("пустое сообщение не записывается, жалоба политики записывается", async () => {
    const at = new Date("2026-11-01T10:00:00Z");
    await recordError({ source: "BROWSER", message: "   " }, at);
    expect(await prisma.errorEvent.count()).toBe(0);
    await recordError({ source: "CSP", message: "script-src заблокировал inline", place: "/" }, at);
    const rows = await recentErrors();
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceLabel).toBe("Политика CSP");
  });

  it("счёт за сутки и за неделю и число разных сбоев", async () => {
    const now = new Date("2026-11-01T10:00:00Z");
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const longAgo = new Date(now.getTime() - 5 * 86_400_000);
    await recordError({ source: "SERVER", message: "Свежий сбой", place: "/" }, hourAgo);
    await recordError({ source: "SERVER", message: "Свежий сбой", place: "/" }, hourAgo);
    await recordError({ source: "BROWSER", message: "Сбой на той неделе", place: "/" }, longAgo);
    expect(await errorTotals(now)).toEqual({ day: 2, week: 3, kinds: 2 });
  });

  it("записи старше срока уходят сами, когда появляется новый сбой", async () => {
    const now = new Date("2026-11-01T10:00:00Z");
    const old = new Date(now.getTime() - (KEEP_DAYS + 5) * 86_400_000);
    await recordError({ source: "SERVER", message: "Очень старый сбой", place: "/" }, old);
    expect(await prisma.errorEvent.count()).toBe(1);
    await recordError({ source: "SERVER", message: "Новый сбой", place: "/" }, now);
    const rows = await recentErrors();
    expect(rows.map((r) => r.message)).toEqual(["Новый сбой"]);
  });
});

describe("проверка здоровья", () => {
  it("удачная проверка отмечает время, страница «Состояние» его показывает", async () => {
    const before = await healthMarks();
    expect(before.lastOkAt).toBeNull();
    const result = await checkHealth(new Date("2026-11-01T10:00:00Z"));
    expect(result).toEqual({ ok: true, db: true });
    const marks = await healthMarks();
    expect(marks.lastOkAt).not.toBeNull();
    expect(marks.lastFailAt).toBeNull();
    // Запись лежит в настройках, поэтому переживает перезапуск приложения
    const row = await prisma.setting.findUnique({ where: { key: HEALTH_OK_KEY } });
    expect(typeof row?.value).toBe("string");
  });
});

describe("режим управления: подбор пароля", () => {
  async function twoPeople() {
    const people = await prisma.person.findMany({ where: { active: true }, select: { id: true }, orderBy: { slug: "asc" }, take: 2 });
    expect(people).toHaveLength(2);
    return [people[0]!.id, people[1]!.id] as const;
  }

  it("пять неверных попыток к одному человеку с разных адресов закрывают ему режим управления", async () => {
    const [person, other] = await twoPeople();
    const at = new Date("2026-11-01T10:00:00Z");
    for (let i = 0; i < MAX_FAILURES; i++) {
      const reserved = await reserveManagementAttempt(`10.0.0.${i + 1}`, person, new Date(at.getTime() + i * 1000));
      expect(reserved.ok).toBe(true);
    }
    // Шестая попытка с нового адреса: по адресу всё чисто, но по человеку порог достигнут
    const blocked = await reserveManagementAttempt("10.0.0.99", person, new Date(at.getTime() + 6000));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.scope).toBe("person");
    // Другому владельцу с того же нового адреса режим управления открыт: счётчик у каждого свой
    const another = await reserveManagementAttempt("10.0.0.99", other, new Date(at.getTime() + 7000));
    expect(another.ok).toBe(true);
  });

  it("счёт по адресу остался: пять неверных попыток с одного адреса тоже закрывают вход", async () => {
    const [person] = await twoPeople();
    const at = new Date("2026-11-01T11:00:00Z");
    for (let i = 0; i < MAX_FAILURES; i++) {
      const reserved = await reserveManagementAttempt("10.0.1.1", person, new Date(at.getTime() + i * 1000));
      expect(reserved.ok).toBe(true);
    }
    const blocked = await reserveManagementAttempt("10.0.1.1", person, new Date(at.getTime() + 6000));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.scope).toBe("ip");
  });

  it("попытка во время блокировки её не продлевает и записывается отдельно", async () => {
    const [person] = await twoPeople();
    const at = new Date("2026-11-01T12:00:00Z");
    for (let i = 0; i < MAX_FAILURES; i++) await reserveManagementAttempt("10.0.2.1", person, new Date(at.getTime() + i * 1000));
    await reserveManagementAttempt("10.0.2.1", person, new Date(at.getTime() + 6000));
    expect(await prisma.loginAttempt.count({ where: { kind: "MANAGEMENT", blocked: true } })).toBe(1);
    // Через 15 минут режим управления снова можно включать
    const later = await reserveManagementAttempt("10.0.2.1", person, new Date(at.getTime() + 16 * 60_000));
    expect(later.ok).toBe(true);
  });
});

describe("зеркало в Google только по департаменту", () => {
  const TITLE_OWN = "Задача своего департамента (этап 86)";
  const TITLE_OTHER = "Задача чужого департамента (этап 86)";

  it("с переменной SHEET_DEPARTMENT_ONLY в таблицу идут только свои, без неё всё как было", async () => {
    const saved = process.env.SHEET_DEPARTMENT_ONLY;
    const owner = await actorFor("muradyan", "OWNER");
    const [leader, mine, alien] = await Promise.all([
      prisma.person.findUniqueOrThrow({ where: { slug: "muradyan" } }),
      prisma.person.findUniqueOrThrow({ where: { slug: "reva" } }),
      prisma.person.findUniqueOrThrow({ where: { slug: "loginova" } }),
    ]);
    const company = await prisma.orgUnit.create({ data: { name: "Сравни (этап 86)", kind: "COMPANY" } });
    const own = await prisma.orgUnit.create({ data: { name: "Департамент страхования (этап 86)", kind: "DEPARTMENT", parentId: company.id } });
    const other = await prisma.orgUnit.create({ data: { name: "Департамент другой (этап 86)", kind: "DEPARTMENT", parentId: company.id } });
    const unitBefore = { leader: leader.unitId, mine: mine.unitId, alien: alien.unitId };
    const top = await prisma.team.findUniqueOrThrow({ where: { id: "top" } });
    try {
      // Свой департамент считается по руководителю топ-команды
      await prisma.team.update({ where: { id: "top" }, data: { leaderId: leader.id } });
      await prisma.person.update({ where: { id: leader.id }, data: { unitId: own.id } });
      await prisma.person.update({ where: { id: mine.id }, data: { unitId: own.id } });
      await prisma.person.update({ where: { id: alien.id }, data: { unitId: other.id } });
      await createTask(owner, { title: TITLE_OWN, outcome: "Проверка отбора", owner: "reva", direction: "product", due: "2030-02-10", source: "weekly" });
      await createTask(owner, { title: TITLE_OTHER, outcome: "Проверка отбора", owner: "loginova", direction: "red", due: "2030-02-10", source: "weekly" });
      const numbers = await prisma.task.findMany({ where: { title: { in: [TITLE_OWN, TITLE_OTHER] } }, select: { number: true, title: true } });
      const numberOf = (title: string) => String(numbers.find((t) => t.title === title)!.number);

      // Без переменной отбора нет: в таблицу идут обе задачи, как до этапа 86
      delete process.env.SHEET_DEPARTMENT_ONLY;
      expect(await loadDepartmentGate()).toMatchObject({ on: false, name: null });
      const all = await taskRows(null);
      expect(all.has(numberOf(TITLE_OWN))).toBe(true);
      expect(all.has(numberOf(TITLE_OTHER))).toBe(true);

      // С переменной: чужой департамент в таблицу не попадает
      process.env.SHEET_DEPARTMENT_ONLY = "1";
      const gate = await loadDepartmentGate();
      expect(gate.on).toBe(true);
      expect(gate.name).toBe(own.name);
      expect(gate.allowsSlug("reva")).toBe(true);
      expect(gate.allowsSlug("loginova")).toBe(false);
      // Человек без подразделения ещё не в структуре: его работа в таблицу идёт
      expect(gate.allowsSlug("fatyanov")).toBe(true);
      const only = await taskRows(null);
      expect(only.has(numberOf(TITLE_OWN))).toBe(true);
      expect(only.has(numberOf(TITLE_OTHER))).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.SHEET_DEPARTMENT_ONLY;
      else process.env.SHEET_DEPARTMENT_ONLY = saved;
      await prisma.task.deleteMany({ where: { title: { in: [TITLE_OWN, TITLE_OTHER] } } });
      await prisma.person.update({ where: { id: leader.id }, data: { unitId: unitBefore.leader } });
      await prisma.person.update({ where: { id: mine.id }, data: { unitId: unitBefore.mine } });
      await prisma.person.update({ where: { id: alien.id }, data: { unitId: unitBefore.alien } });
      await prisma.team.update({ where: { id: "top" }, data: { leaderId: top.leaderId } });
      await prisma.orgUnit.deleteMany({ where: { id: { in: [own.id, other.id] } } });
      await prisma.orgUnit.delete({ where: { id: company.id } });
      // Очередь выгрузки от созданных задач не нужна: таблица в тестах не подключена
      await prisma.sheetOutbox.deleteMany();
    }
  });
});
