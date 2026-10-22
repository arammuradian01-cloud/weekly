import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { config as proxyConfig } from "@/proxy";
import { PACKAGE_MAX_BYTES, PackageError, cleanText, parsePackage, personnelMarker, recordHash } from "@/lib/content-import/package";

// Импорт наполнения (этап 67): разбор и проверка пакета без базы, фильтр кадровых сведений, устойчивость к странному
// JSON и обработчик загрузки (мимо proxy: вход, права, адрес страницы и размер до чтения тела, тело потоком с
// пределом). Пакет синтетический: tests/fixtures/content-import. Вход и служба импорта в обработчике подменены

const state = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  actor: null as null | Record<string, unknown> | "redirect",
  calls: [] as { mode: string; duplicates: boolean; tasks: number; keys?: string[]; due?: string }[],
}));

vi.mock("@/lib/auth", () => ({
  readSession: async () => state.session,
  requestIp: async () => "127.0.0.1",
}));
vi.mock("@/lib/action-runner", () => ({
  currentActor: async () => {
    // Устройство отозвано или профиль выключен: вход перенаправляет на экран входа
    if (state.actor === "redirect") redirect("/login?ended=1");
    return state.actor;
  },
}));
vi.mock("@/lib/content-import/service", () => ({
  IMPORT_ONLY: "Наполнение загружает владелец при личном входе в режиме управления",
  canImportContent: (a: { role: string; management: string | null; via?: string | null }) => a.role === "OWNER" && a.management === "OWNER" && !!a.via && a.via !== "TEAM",
  previewContentImport: async (_actor: unknown, pkg: { tasks: unknown[] }, opts: { duplicates?: boolean; duplicateKeys?: string[]; staleDue?: string }) => {
    state.calls.push({ mode: "preview", duplicates: !!opts.duplicates, tasks: pkg.tasks.length, ...(opts.duplicateKeys?.length ? { keys: opts.duplicateKeys } : {}), ...(opts.staleDue ? { due: opts.staleDue } : {}) });
    return { title: "пакет" };
  },
  applyContentImport: async (_actor: unknown, pkg: { tasks: unknown[] }, opts: { duplicates?: boolean; duplicateKeys?: string[]; staleDue?: string }) => {
    state.calls.push({ mode: "apply", duplicates: !!opts.duplicates, tasks: pkg.tasks.length, ...(opts.duplicateKeys?.length ? { keys: opts.duplicateKeys } : {}), ...(opts.staleDue ? { due: opts.staleDue } : {}) });
    return { title: "пакет", applied: { tasks: [] } };
  },
}));

const { POST } = await import("@/app/api/content-import/route");

const { getMiddlewareMatchers } = createRequire(import.meta.url)("next/dist/build/analysis/get-page-static-info") as {
  getMiddlewareMatchers: (matcher: string[], config: object) => { regexp: string }[];
};

const FIXTURE = readFileSync("tests/fixtures/content-import/package.json", "utf8");
const fixture = () => JSON.parse(FIXTURE) as Record<string, unknown> & { tasks: Record<string, unknown>[]; goals: Record<string, unknown>[]; decisions: Record<string, unknown>[]; links: Record<string, unknown>[] };
const parse = (value: unknown) => parsePackage(JSON.stringify(value));
const MB = 1024 * 1024;
const owner = { personId: "p1", slug: "muradyan", fullName: "Мурадян Арам", role: "OWNER", management: "OWNER", ip: "127.0.0.1", via: "PASSWORD" };
/** Список, вложенный сам в себя на много уровней: String() и JSON.stringify от него падают по стеку */
const deep = (depth = 100_000) => JSON.parse("[".repeat(depth) + "]".repeat(depth)) as unknown;

describe("разбор пакета", () => {
  it("синтетический пакет читается без ошибок, тексты приводятся к виду ресурса", () => {
    const { pkg, problems } = parsePackage(FIXTURE);
    expect(problems).toEqual([]);
    expect(pkg.excluded).toEqual([]);
    expect(pkg.title).toBe("Синтетический пакет для тестов");
    expect(pkg.goals.map((g) => g.key)).toEqual(["goal.test.dept-1", "goal.test.reva-1"]);
    expect(pkg.goals[1]!.parent).toEqual({ key: "goal.test.dept-1" });
    expect(pkg.tasks).toHaveLength(5);
    // Длинное тире заменено дефисом
    expect(pkg.tasks[0]!.outcome).toBe("Сводка в одном файле - с выводами");
    // Статус по умолчанию «В работе», источник по умолчанию «Другое»
    expect(pkg.tasks[3]).toMatchObject({ status: "in-progress", source: { kind: "other", note: null, date: null }, coExecutors: ["Сахибуллина Алсу", "Сидоров Никто"] });
    expect(pkg.decisions[1]).toMatchObject({ status: "cancelled", cancelReason: "Передумали на следующей тестовой встрече", team: "Топ-команда" });
    expect(pkg.links[0]).toMatchObject({ task: { key: "task.test.open-1" }, goal: { key: "goal.test.dept-1" }, confidence: "высокая" });
  });

  it("не пакет наполнения: не JSON, другой формат, слишком большой файл", () => {
    expect(() => parsePackage("{ не json")).toThrow(PackageError);
    expect(() => parse({ format: "weekly-napolnenie/2", tasks: [] })).toThrow(/format/);
    expect(() => parse([])).toThrow(/нет полей пакета/);
    expect(PACKAGE_MAX_BYTES).toBe(5 * MB);
    expect(() => parsePackage("{}", PACKAGE_MAX_BYTES + 1)).toThrow(/больше 5 МБ/);
  });

  it("ошибки собираются все сразу: ключи, обязательные поля, даты, статусы, итог закрытой задачи", () => {
    const p = fixture();
    p.tasks[0]!.key = "плохой ключ";
    p.tasks[1]!.key = "task.test.open-1";
    p.tasks[2]!.due = "2026-02-30";
    p.tasks[3]!.status = "proposed";
    delete p.tasks[1]!.resolution;
    p.tasks[4]!.title = "";
    p.goals[0]!.quarter = "4 квартал";
    p.goals[1]!.link = "ftp://example.com";
    const { problems } = parse(p);
    const text = problems.join("\n");
    expect(text).toMatch(/ключ «плохой ключ» пустой или с недопустимыми знаками/);
    expect(text).toMatch(/«Срок» не дата/);
    expect(text).toMatch(/«Статус»: «proposed» не из списка/);
    expect(text).toMatch(/для статуса «done» нужен итог/);
    expect(text).toMatch(/не заполнено «Задача»/);
    expect(text).toMatch(/квартал в виде 2026-Q4/);
    expect(text).toMatch(/ссылка должна начинаться с https/);
  });

  it("повтор ключа и ссылки на записи, которых нет в пакете", () => {
    const p = fixture();
    p.tasks[1]!.key = p.tasks[0]!.key;
    p.decisions[0]!.tasks = [{ key: "task.nope" }, { number: 12 }];
    p.links.push({ key: "link.test.3", task: { key: "task.test.open-1" }, goal: { code: "РТ-1" } });
    p.links.push({ key: "link.test.4", task: { number: 5 }, goal: { key: "goal.nope" } });
    p.goals[1]!.parent = { key: "goal.nope" };
    const { problems } = parse(p);
    const text = problems.join("\n");
    expect(text).toMatch(/ключ «task.test.open-1» повторяется/);
    expect(text).toMatch(/задачи с ключом «task.nope» в пакете нет/);
    expect(text).toMatch(/цели с ключом «goal.nope» в пакете нет/);
    expect(text).toMatch(/цели выше с ключом «goal.nope» в пакете нет/);
    // Одна задача к двум целям: противоречие в самом пакете
    expect(text).toMatch(/связи link.test.1 и link.test.3: одна задача привязана к двум целям/);
  });

  it("отменённое решение без причины и задача без ответственного", () => {
    const p = fixture();
    delete p.decisions[1]!.cancelReason;
    delete p.tasks[0]!.owner;
    const { problems } = parse(p);
    expect(problems.join("\n")).toMatch(/для отменённого решения нужна причина/);
    expect(problems.join("\n")).toMatch(/не заполнено «Ответственный»/);
  });

  it("ссылки задачи по правилам службы задач: подпись до 120 знаков, адрес до 500, только http и https", () => {
    const p = fixture();
    p.tasks[0]!.links = [
      { title: "П".repeat(121), url: "https://example.com/a" },
      { title: "Длинный адрес", url: `https://example.com/${"a".repeat(500)}` },
      { title: "Не адрес", url: "javascript:alert(1)" },
      "просто строка",
      { title: "Без адреса" },
    ];
    p.tasks[1]!.links = { url: "https://example.com" };
    const text = parse(p).problems.join("\n");
    expect(text).toMatch(/«Подпись ссылки» длиннее 120 знаков/);
    expect(text).toMatch(/«Адрес ссылки» длиннее 500 знаков/);
    expect(text).toMatch(/ссылка «javascript:alert\(1\)» не начинается с https/);
    expect(text).toMatch(/ссылка 4 должна быть записью/);
    expect(text).toMatch(/не заполнено «Адрес ссылки»/);
    expect(text).toMatch(/«Ссылки» должны быть списком/);
  });

  it("название пакета коротким текстом: оно пишется в журнал", () => {
    const p = fixture();
    p.title = "Н".repeat(201);
    expect(parse(p).problems.join("\n")).toMatch(/пакет: «Название пакета» длиннее 200 знаков/);
    p.title = { name: "пакет" };
    expect(parse(p).problems.join("\n")).toMatch(/«Название пакета» должно быть текстом/);
  });
});

describe("устойчивый разбор", () => {
  it("списки и объекты вместо текста: ошибки списком, а не падение разбора", () => {
    // Файл собираем строкой: JSON.stringify от глубоко вложенных значений сам упал бы по стеку
    const nest = (depth: number) => "[".repeat(depth) + "]".repeat(depth);
    const swaps: [string, string][] = [
      ['"title": "Синтетический пакет для тестов"', `"title": ${nest(100_000)}`],
      ['"createdAt": "2026-10-22"', `"createdAt": { "a": ${nest(50_000)} }`],
      ['"status": "done"', `"status": ${nest(50_000)}`],
      ['"links": [{ "title": "Пример", "url": "https://example.com/doc" }]', `"links": [{ "title": ${nest(50_000)}, "url": ${nest(50_000)} }]`],
      ['"code": "ТД-1"', `"code": ${nest(50_000)}`],
      ['"tasks": [{ "key": "task.test.open-1" }, { "key": "task.test.done-1" }]', `"tasks": [${nest(50_000)}, { "key": ${nest(1000)} }]`],
      ['"goal": { "key": "goal.test.dept-1" }, "confidence"', `"goal": { "code": ${nest(50_000)} }, "confidence"`],
    ];
    let text = FIXTURE;
    for (const [from, to] of swaps) {
      expect(text.includes(from), from).toBe(true);
      text = text.replace(from, to);
    }
    let result: ReturnType<typeof parsePackage> | undefined;
    expect(() => (result = parsePackage(text))).not.toThrow();
    const problems = result!.problems.join("\n");
    expect(problems).toMatch(/«Название пакета» должно быть текстом/);
    expect(problems).toMatch(/«Дата сборки пакета» должно быть текстом/);
    expect(problems).toMatch(/«Статус»: «список» не из списка/);
    expect(problems).toMatch(/«Подпись ссылки» должно быть текстом/);
    expect(problems).toMatch(/«Адрес ссылки» должно быть текстом/);
    expect(problems).toMatch(/«Номер цели» должно быть текстом/);
    expect(problems).toMatch(/«Задачи решения»: нужна ссылка на задачу/);
    expect(problems).toMatch(/«Цель»: нужна ссылка на цель/);
    expect(result!.pkg.title).toBeNull();
  });

  it("текст только из строки и числа: список и объект дают пустую строку", () => {
    expect(cleanText(deep())).toBe("");
    expect(cleanText({ a: 1 })).toBe("");
    expect(cleanText(12)).toBe("12");
    expect(cleanText(Number.NaN)).toBe("");
  });
});

describe("кадровые сведения", () => {
  it("маркеры с начала слова: оплата, оценки, судьбы людей", () => {
    for (const [text, marker] of [
      ["Пересмотреть оклады отдела", "оклады"],
      ["Подготовить ревизию грейдов", "грейдов"],
      ["Фонд зарплаты на 2027", "зарплаты"],
      ["Зарплата аналитика партнёрств", "зарплата"],
      ["Заработная плата аналитиков", "заработная плата"],
      ["Поднять ЗП аналитику", "зп"],
      ["Пересмотр з/п команды", "з/п"],
      ["ФОТ на 2027 по департаменту", "фот"],
      ["Фонд оплаты труда департамента", "фонд оплаты"],
      ["Оплата труда менеджеров КЦ", "оплата труда"],
      ["Калибровка оценок сотрудников до 30.11", "калибровка оценок"],
      ["Калибровка грейдов в команде", "калибровка грейдов"],
      ["Уволить менеджера по партнёрам", "уволить"],
      ["Замена на время декрета", "декрета"],
      ["Пока на больничном", "на больничном"],
      ["Менеджер на больничном до пятницы", "на больничном"],
      ["Ушёл на больничный, задачи передать", "на больничный"],
      ["Больничный сотрудника продаж", "больничный сотрудника"],
      ["Сокращение штата КЦ", "сокращение штата"],
      ["Сокращение отдела партнёрств", "сокращение отдела"],
      ["Сократить двух менеджеров", "сократить двух менеджеров"],
      ["Сократить 3 ставки в КЦ", "сократить 3 ставки"],
      ["Сокращение в команде КЦ", "сокращение в команде"],
      ["Оценка сотрудников КЦ по итогам квартала", "оценка сотрудников"],
      ["Оценка эффективности сотрудников продаж", "оценка эффективности сотрудников"],
      ["Аттестация аналитиков в декабре", "аттестация"],
      ["Премия сотрудникам КЦ за квартал", "премия сотрудникам"],
      ["Бонусы менеджерам за квартал", "бонусы менеджерам"],
      ["Годовая премия команды продаж", "премия команды"],
      ["Бонусы сотрудникам за квартал", "бонусы сотрудникам"],
    ] as const) {
      expect(personnelMarker(text), text).toBe(marker);
    }
  });

  it("не кадровое: страховые и банковские термины, сроки и расходы, слова с похожим началом", () => {
    for (const text of [
      "Доклад на встрече топ-команды",
      "Апгрейд витрины ОСАГО",
      "Страховая премия по КАСКО выросла",
      "Премия по полису",
      "Годовая премия по КАСКО у партнёра",
      "Зарплатный проект с банком-партнёром",
      "Зарплатные клиенты банка",
      "Предложение для держателей зарплатной карты",
      "Калибровка пула ОСАГО по СК",
      "Калибровка оценок риска по КАСКО",
      "Калибровка оценки рисков в скоринге",
      "Калибровка скоринга",
      "Калибровка скоринговой модели",
      "Выплата по больничному листу (продукт НС)",
      "Выплата по больничному в коробке НС",
      "Сокращение сроков урегулирования",
      "Сократить расходы отдела",
      "Сократить траты команды на рекламу",
      "Фото полиса в карточке",
      "Фотофиксация ущерба",
      "Мотивация менеджеров прямых продаж КАСКО",
      "Оценка рынка КАСКО",
      "Оценка эффективности канала",
    ]) {
      expect(personnelMarker(text), text).toBeNull();
    }
  });

  it("запись с кадровыми сведениями остаётся в пакете, но уходит в список «не загрузятся»; пакет без ошибок", () => {
    const p = fixture();
    p.tasks[0]!.whereNow = "Ждём решения по окладу аналитика";
    p.decisions[0]!.text = "Премии сотрудникам считаем по новой схеме";
    p.goals[1]!.metric = "Калибровка грейдов в команде";
    p.tasks[2]!.title = "Подготовить доклад по рынку";
    const { pkg, problems } = parse(p);
    expect(problems).toEqual([]);
    expect(pkg.tasks).toHaveLength(5);
    expect(pkg.excluded.map((e) => `${e.kind}/${e.key}`)).toEqual(["goal/goal.test.reva-1", "task/task.test.open-1", "decision/decision.test.1"]);
    expect(pkg.excluded[1]).toMatchObject({ what: "Задача «Собрать тестовую сводку по выдуманным партнёрам»", text: expect.stringMatching(/^кадровые сведения \(«окладу» в поле «Где сейчас»\): такие записи в ресурс не загружаются/) });
  });
});

describe("отпечаток записи", () => {
  it("не зависит от порядка полей и меняется от содержания", () => {
    const a = { key: "x", title: "Задача", owner: "Рева Тарас", links: [{ url: "https://a", title: null }] };
    const b = { owner: "Рева Тарас", links: [{ title: null, url: "https://a" }], title: "Задача", key: "x" };
    expect(recordHash(a)).toBe(recordHash(b));
    expect(recordHash({ ...a, title: "Другая задача" })).not.toBe(recordHash(a));
    expect(recordHash(a)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("текст без длинного тире и стрелок, переносы строк только где нужны", () => {
    expect(cleanText("  Итог — готово → дальше  ")).toBe("Итог - готово - дальше");
    expect(cleanText("Строка 1\r\n\r\n\r\nСтрока 2", true)).toBe("Строка 1\n\nСтрока 2");
    expect(cleanText(null)).toBe("");
  });
});

// ---------- Обработчик загрузки ----------

/** Тело запроса, которое считает, сколько из него прочитано: чтение идёт только по запросу обработчика */
function countingBody(total: number, chunk = MB) {
  const seen = { bytes: 0, pulls: 0 };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seen.pulls++;
        if (seen.bytes >= total) return controller.close();
        const n = Math.min(chunk, total - seen.bytes);
        seen.bytes += n;
        controller.enqueue(new Uint8Array(n).fill(32));
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, seen };
}

function send(body: BodyInit | ReadableStream<Uint8Array>, query = "mode=preview", headers: Record<string, string> = {}) {
  return POST(new Request(`http://localhost:3000/api/content-import?${query}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, duplex: "half" } as RequestInit));
}

describe("обработчик импорта мимо proxy", () => {
  beforeEach(() => {
    state.session = { personId: "p1", sid: "d1" };
    state.actor = owner;
    state.calls = [];
  });

  it("путь исключён из proxy, соседние пути и страницы за входом", () => {
    const [compiled] = getMiddlewareMatchers(proxyConfig.matcher, {});
    const gated = new RegExp(compiled!.regexp);
    expect(gated.test("/api/content-import")).toBe(false);
    expect(gated.test("/api/content-import/")).toBe(false);
    for (const path of ["/api/content-imports", "/api/content-import-x", "/api/content-import/x", "/settings", "/"]) expect(gated.test(path), path).toBe(true);
  });

  it("владелец: предпросмотр и загрузка, флаг дублей доходит до службы, ответ без кэша", async () => {
    const res = await send(FIXTURE, "mode=preview", { origin: "http://localhost:3000", "content-length": String(Buffer.byteLength(FIXTURE)) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, value: { title: "пакет" } });
    expect((await send(FIXTURE, "mode=apply&duplicates=1")).status).toBe(200);
    // Выбранные дубли и срок для задач без актуального срока; чужие строки в списке дублей отбрасываются
    expect((await send(FIXTURE, "mode=apply&dup=task/task.test.open-1,decision/decision.test.1,goal/x,task/плохой&due=2026-11-05")).status).toBe(200);
    expect(state.calls).toEqual([
      { mode: "preview", duplicates: false, tasks: 5 },
      { mode: "apply", duplicates: true, tasks: 5 },
      { mode: "apply", duplicates: false, tasks: 5, keys: ["task/task.test.open-1", "decision/decision.test.1"], due: "2026-11-05" },
    ]);
    const bad = await send(FIXTURE, "mode=preview&due=05.11.2026");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Срок для задач без актуального срока: дата в виде ГГГГ-ММ-ДД");
    expect(state.calls).toHaveLength(3);
  });

  it("чужой сайт, нет входа, вход больше не действует, не владелец: ответ сразу текстом, тело не читается", async () => {
    const cases: [() => void, Record<string, string>, number, RegExp][] = [
      [() => undefined, { origin: "https://evil.example" }, 403, /Запрос с чужого сайта/],
      [() => (state.session = null), {}, 401, /Вход больше не действует/],
      [() => (state.actor = "redirect"), {}, 401, /Вход больше не действует/],
      [() => (state.actor = { ...owner, role: "ADMIN", management: "ADMIN" }), {}, 403, /загружает владелец при личном входе/],
      [() => (state.actor = { ...owner, via: "TEAM" }), {}, 403, /загружает владелец при личном входе/],
      [() => (state.actor = { ...owner, management: null }), {}, 403, /в режиме управления/],
    ];
    for (const [setup, headers, status, error] of cases) {
      state.session = { personId: "p1", sid: "d1" };
      state.actor = owner;
      setup();
      const { stream, seen } = countingBody(8 * MB);
      const res = await send(stream, "mode=apply", headers);
      expect(res.status, String(error)).toBe(status);
      // Без перенаправления на вход: браузер не повторяет POST с файлом
      expect(res.headers.get("location")).toBeNull();
      expect((await res.json()).error).toMatch(error);
      expect(seen.pulls, String(error)).toBe(0);
    }
    expect(state.calls).toEqual([]);
  });

  it("больше 5 МБ по заголовку: 413 до чтения тела; без заголовка чтение обрывается на пределе", async () => {
    const first = countingBody(8 * MB);
    const res = await send(first.stream, "mode=preview", { "content-length": String(6 * MB) });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("Файл пакета больше 5 МБ: разделите его на части");
    expect(first.seen.pulls).toBe(0);

    const second = countingBody(100 * MB);
    const cut = await send(second.stream);
    expect(cut.status).toBe(413);
    expect(second.seen.bytes).toBeGreaterThan(5 * MB);
    expect(second.seen.bytes).toBeLessThanOrEqual(7 * MB);
    expect(state.calls).toEqual([]);
  });

  it("глубоко вложенный JSON и ошибки пакета: 400 со списком, а не 500", async () => {
    const text = FIXTURE.replace('"title": "Синтетический пакет для тестов"', `"title": ${"[".repeat(100_000)}${"]".repeat(100_000)}`);
    const res = await send(text);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; problems: string[] };
    expect(body.error).toMatch(/В пакете ошибки: 1/);
    expect(body.problems[0]).toMatch(/«Название пакета» должно быть текстом/);
    const broken = await send("{ не json");
    expect(broken.status).toBe(400);
    expect((await broken.json()).error).toMatch(/не читается как JSON/);
    expect(state.calls).toEqual([]);
  });
});
