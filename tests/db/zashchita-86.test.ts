// Этап 86: защита и наблюдение на настоящей базе.
// - сбор сбоев: одинаковые складываются в одну запись со счётчиком, поток новых складывается в одну, старые уходят;
// - оповещения: уходят только о сбоях сервера и не чаще раза в час, текст сбоя в них не попадает;
// - обработчик /api/errors: предел тела и предел сообщений с одного адреса;
// - проверка здоровья отмечает время удачной проверки;
// - режим управления: счёт неверных попыток и по адресу, и по человеку (этап 29 считал только по адресу).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// server-only в тестах базы подменяется пустышкой, как в остальных тестах базы (view-as, team-management):
// иначе модуль службы страницы «Состояние» не импортируется
vi.mock("server-only", () => ({}));

// Telegram в тестах не вызывается: подменяем модуль оповещений и смотрим, о чём ресурс пытался оповестить
const alerts = vi.hoisted(() => ({ calls: [] as { source: string; place?: string | null; times: number }[] }));
vi.mock("@/lib/alerts", () => ({
  notifyError: async (alert: { source: string; place?: string | null; times: number }) => {
    alerts.calls.push(alert);
    return true;
  },
  alertsConfigured: () => true,
  sendTelegram: async () => true,
  telegramConfig: () => null,
  telegramUrl: () => "",
  errorAlertText: () => "",
  ALERT_TIMEOUT_MS: 5_000,
  ALERT_TEXT_MAX: 3_000,
}));

import { prisma } from "@/lib/db";
import { FLOOD_FINGERPRINT, FLOOD_MAX, KEEP_DAYS, REPORTS_PER_IP, REPORT_BODY_MAX, errorTotals, recentErrors, recordError } from "@/lib/errors";
import { HEALTH_OK_KEY, checkHealth, databaseAlive, healthMarks } from "@/lib/health";
import { MAX_FAILURES } from "@/lib/rate-limit";
import { reserveManagementAttempt } from "@/lib/login/attempts";
import { actorFor, createTask } from "@/lib/tasks/service";
import { loadDepartmentGate } from "@/lib/sheet/department";
import { taskRows } from "@/lib/sheet/rows";
import { POST } from "@/app/api/errors/route";
import { clearErrors } from "@/lib/status-service";
import { FakeSheets } from "@/lib/sheet/fake";
import { ID_HEADER, SUMMARY_TAB, TASKS_TAB } from "@/lib/sheet/rows";
import { rebuild } from "@/lib/sheet/sync";

beforeEach(async () => {
  await prisma.errorEvent.deleteMany();
  await prisma.loginAttempt.deleteMany();
  await prisma.setting.deleteMany({ where: { key: { startsWith: "health." } } });
  alerts.calls.length = 0;
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

describe("оповещения о сбоях", () => {
  const now = new Date("2026-11-02T10:00:00Z");

  it("уходит только сбой сервера: по открытому обработчику владельцу не пишут (замечание ревью)", async () => {
    // Сбой браузера и жалобу политики присылает кто угодно из интернета, без входа и с любым текстом:
    // оповещать по ним нельзя, иначе этим каналом можно обманывать владельца и забить лимиты Telegram
    await recordError({ source: "BROWSER", message: "Я ваш сервер, всё сломалось", place: "/" }, now);
    await recordError({ source: "CSP", message: "script-src заблокировал inline", place: "/" }, now);
    expect(alerts.calls).toEqual([]);

    await recordError({ source: "SERVER", message: "Нет связи с базой", place: "/tasks" }, now);
    expect(alerts.calls).toHaveLength(1);
    expect(alerts.calls[0]).toMatchObject({ source: "Сервер", place: "/tasks", times: 1 });
    // Текста сбоя в оповещении нет: в нём бывает содержимое загруженных файлов
    expect(JSON.stringify(alerts.calls[0])).not.toContain("Нет связи с базой");
    expect((await prisma.errorEvent.findFirstOrThrow({ where: { source: "SERVER" } })).notifiedAt).not.toBeNull();
  });

  it("об одном и том же сбое сервера не чаще раза в час", async () => {
    await recordError({ source: "SERVER", message: "Нет связи с базой", place: "/tasks" }, now);
    await recordError({ source: "SERVER", message: "Нет связи с базой", place: "/tasks" }, new Date(now.getTime() + 60_000));
    expect(alerts.calls).toHaveLength(1);
    await recordError({ source: "SERVER", message: "Нет связи с базой", place: "/tasks" }, new Date(now.getTime() + 61 * 60_000));
    expect(alerts.calls).toHaveLength(2);
    expect(alerts.calls[1]).toMatchObject({ times: 3 });
  });

  it("поток новых сбоев складывается в одну запись: таблица не растёт без предела", async () => {
    await prisma.errorEvent.createMany({
      data: Array.from({ length: FLOOD_MAX }, (_, i) => ({
        source: "BROWSER" as const,
        fingerprint: `fingerprint-${i}`,
        message: `Сбой ${i}`,
        times: 1,
        firstAt: now,
        lastAt: now,
      })),
    });
    // Отпечаток считается по тексту, поэтому сменой одной буквы складывание обходится: спасает только предел
    await recordError({ source: "BROWSER", message: "Совсем новый сбой A", place: "/" }, now);
    await recordError({ source: "BROWSER", message: "Совсем новый сбой B", place: "/" }, now);
    // Новых записей больше не заводится, оба случая ушли в сборник
    expect(await prisma.errorEvent.count()).toBe(FLOOD_MAX + 1);
    const flood = await prisma.errorEvent.findFirstOrThrow({ where: { fingerprint: FLOOD_FINGERPRINT } });
    expect(flood.times).toBe(2);
    expect(flood.message).toContain("Много разных сбоев");
    // Факт потока виден на экране, а не потерян
    expect((await recentErrors()).some((r) => r.message.includes("Много разных сбоев"))).toBe(true);
  });

  it("поток из браузера не съедает бюджет сервера: настоящая авария записывается и оповещает (замечание ревью)", async () => {
    // Открытый обработчик может переполнить бюджет браузера из интернета. Если бюджет общий, настоящая новая
    // авария сервера уходит в сборник: ни текста, ни пути, ни стека, и одно оповещение в час
    await prisma.errorEvent.createMany({
      data: Array.from({ length: FLOOD_MAX + 5 }, (_, i) => ({
        source: "BROWSER" as const,
        fingerprint: `browser-flood-${i}`,
        message: `Чужой текст ${i}`,
        times: 1,
        firstAt: now,
        lastAt: now,
      })),
    });
    await recordError({ source: "SERVER", message: "Can't reach database server", place: "/weekly", stack: "prisma:1" }, now);
    const row = await prisma.errorEvent.findFirstOrThrow({ where: { source: "SERVER" } });
    // Запись своя, а не сборник: текст, путь и стек сохранились
    expect(row.fingerprint).not.toBe(FLOOD_FINGERPRINT);
    expect(row.message).toBe("Can't reach database server");
    expect(row.place).toBe("/weekly");
    expect(row.stack).toBe("prisma:1");
    // И оповещение ушло, с местом
    expect(alerts.calls).toHaveLength(1);
    expect(alerts.calls[0]).toMatchObject({ source: "Сервер", place: "/weekly" });
    // А вот новый сбой браузера складывается в сборник: свой бюджет он уже израсходовал
    await recordError({ source: "BROWSER", message: "И ещё чужой текст", place: "/" }, now);
    expect(await prisma.errorEvent.count({ where: { source: "BROWSER", fingerprint: FLOOD_FINGERPRINT } })).toBe(1);
  });
});

describe("очистка списка сбоев", () => {
  const now = new Date("2026-11-02T10:00:00Z");

  it("владелец очищает, запись в журнале; администратор и лидер не могут", async () => {
    await recordError({ source: "SERVER", message: "Сбой на сервере", place: "/" }, now);
    await recordError({ source: "BROWSER", message: "Сбой в браузере", place: "/" }, now);
    expect(await prisma.errorEvent.count()).toBe(2);

    const admin = await actorFor("golovkin", "ADMIN");
    const leader = await actorFor("reva");
    await expect(clearErrors(admin)).rejects.toThrow(/только владелец/);
    await expect(clearErrors(leader)).rejects.toThrow(/только владелец/);
    expect(await prisma.errorEvent.count()).toBe(2);

    const mark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    const owner = await actorFor("muradyan", "OWNER");
    expect(await clearErrors(owner)).toEqual({ removed: 2 });
    expect(await prisma.errorEvent.count()).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { id: { gt: mark }, action: "errors.clear" } });
    expect([log.actorId, log.after]).toEqual([owner.personId, "очищено записей: 2"]);

    // Пустой список очищать нечего, и записи в журнале не появляется
    expect(await clearErrors(owner)).toEqual({ removed: 0 });
    expect(await prisma.auditLog.count({ where: { id: { gt: mark }, action: "errors.clear" } })).toBe(1);
  });
});

describe("обработчик /api/errors", () => {
  /** Запрос как его видит обработчик: заголовки и тело. Content-Length в тестах не подменить настоящим Request */
  function report(body: string, headers: Record<string, string> = {}): Request {
    return {
      headers: new Headers({ "content-type": "application/json", ...headers }),
      text: async () => body,
    } as unknown as Request;
  }

  const withLength = (body: string) => ({ "content-length": String(Buffer.byteLength(body, "utf8")) });

  it("тело без заявленной длины, с нечисловой длиной и длиннее предела не читается", async () => {
    const body = JSON.stringify({ message: "Не должно записаться", place: "/" });
    const cases: Record<string, string>[] = [{}, { "content-length": "abc" }, { "content-length": String(REPORT_BODY_MAX + 1) }];
    for (const headers of cases) {
      const response = await POST(report(body, headers));
      // Ответ всегда «принято»: по нему нельзя узнать ни про ресурс, ни про людей
      expect(response.status).toBe(204);
    }
    expect(await prisma.errorEvent.count({ where: { message: "Не должно записаться" } })).toBe(0);
  });

  it("с одного адреса принимается не больше REPORTS_PER_IP сообщений в минуту, у соседнего свой счёт", async () => {
    // На стенде TRUST_PROXY=true, и адрес берётся из X-Forwarded-For: так у теста свой адрес и свой счётчик,
    // не зависящий от других запросов в прогоне
    const saved = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "true";
    try {
      const body = JSON.stringify({ message: "Сбой из потока", place: "/" });
      const headers = { ...withLength(body), "x-forwarded-for": "203.0.113.7" };
      for (let i = 0; i < REPORTS_PER_IP + 5; i++) {
        expect((await POST(report(body, headers))).status).toBe(204);
      }
      expect((await prisma.errorEvent.findFirstOrThrow({ where: { message: "Сбой из потока" } })).times).toBe(REPORTS_PER_IP);
      // Сосед с другого адреса не задет
      const other = JSON.stringify({ message: "Сбой соседа", place: "/" });
      expect((await POST(report(other, { ...withLength(other), "x-forwarded-for": "203.0.113.8" }))).status).toBe(204);
      expect((await prisma.errorEvent.findFirstOrThrow({ where: { message: "Сбой соседа" } })).times).toBe(1);
      // И по открытому обработчику никто не оповещается
      expect(alerts.calls).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = saved;
    }
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

  it("страница «Состояние» только спрашивает базу и не затирает отметку (замечание ревью)", async () => {
    // Отметку ставит только /api/health. Если бы её ставила страница, «последняя удачная проверка» всегда
    // показывала бы момент открытия страницы, и по ней нельзя было бы увидеть, что проверки перестали приходить
    await checkHealth(new Date("2026-11-03T10:00:00Z"));
    const before = await healthMarks();
    expect(before.lastOkAt).not.toBeNull();
    expect(await databaseAlive()).toBe(true);
    expect((await healthMarks()).lastOkAt).toBe(before.lastOkAt);
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

      // И в таблице: строки чужой задачи нет, а в сводке нет её ответственного (замечание ревью: сводка брала
      // людей своим запросом и оставляла ФИО чужих департаментов с нулями во всех колонках)
      // Замок и разметка с чистого листа: соседний файл тестов мог оставить свои
      await prisma.setting.deleteMany({ where: { key: { in: ["sheet.layout", "sheet.synced", "sheet.lock"] } } });
      const fake = new FakeSheets();
      await rebuild(fake, { serviceEmail: "weekly-sync@test.iam.gserviceaccount.com" });
      const tasksGrid = fake.tab(TASKS_TAB.title).grid;
      const idAt = tasksGrid[0]!.indexOf(ID_HEADER);
      const ids = tasksGrid.slice(1).map((r) => String(r[idAt] ?? ""));
      expect(ids).toContain(numberOf(TITLE_OWN));
      expect(ids).not.toContain(numberOf(TITLE_OTHER));
      const summaryNames = fake
        .tab(SUMMARY_TAB.title)
        .grid.slice(1)
        .map((r) => String(r[0] ?? ""));
      expect(summaryNames).toContain(mine.fullName);
      expect(summaryNames).not.toContain(alien.fullName);
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
      await prisma.setting.deleteMany({ where: { key: { in: ["sheet.layout", "sheet.synced", "sheet.lock"] } } });
      await prisma.sheetRun.deleteMany();
    }
  });
});
