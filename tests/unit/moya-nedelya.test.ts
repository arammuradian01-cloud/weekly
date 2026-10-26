// Этап 76 (решения Арама 23.10.2026): раздел «Мне» влит в «Мою неделю» блоком «Ждёт вас», «Один на один» удалён.
// Перенаправления старых адресов, ссылки уведомлений и писем, общие функции, которые переехали из модуля один на один,
// и сторож: в коде не осталось ссылок на убранные разделы
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";
import { QUEUE_PATH, eventPhrase, pathOf } from "@/lib/letters/phrases";
import { personalLogin } from "@/lib/login/personal";
import { cleanPhrase } from "@/lib/phrase";
import { submitWeekHref } from "@/lib/weekly/weeks";
import { relevant } from "@/lib/live-message";

// У next.config.mjs нет объявления типов: читаем его как модуль по адресу файла, как в market.test.ts
const nextConfig = ((await import(pathToFileURL(join(process.cwd(), "next.config.mjs")).href)) as { default: NextConfig }).default;

describe("перенаправления убранных разделов", () => {
  it("/me, /one-on-one и вложенные ведут на «Мою неделю» временным переходом", async () => {
    const redirects = await nextConfig.redirects!();
    const of = (source: string) => redirects.find((r) => r.source === source);
    for (const source of ["/me", "/one-on-one", "/one-on-one/:path*"]) {
      expect(of(source), source).toMatchObject({ destination: "/", permanent: false });
    }
    // Прежние постоянные переходы на «Люди» на месте
    expect(of("/team")).toMatchObject({ destination: "/people", permanent: true });
  });
});

describe("ссылки уведомлений и писем", () => {
  it("событие без своей страницы ведёт в очередь «Ждёт вас» на «Моей неделе», а не в «Мне»", () => {
    expect(QUEUE_PATH).toBe("/#me-queue");
    expect(pathOf({ taskNumber: null, entryId: null })).toBe("/#me-queue");
    expect(pathOf({ taskNumber: null, entryId: null, subject: "decision:abc" })).toBe("/#me-queue");
    // Старое событие встречи один на один (если оно где-то осталось) не ведёт на удалённую страницу
    expect(pathOf({ taskNumber: null, entryId: null, subject: "1on1:pair-1" })).toBe("/#me-queue");
    expect(eventPhrase({ kind: "ONE_ON_ONE", actorName: "Мурадян Арам", taskNumber: null, entryId: null, commentId: null })).toBe("Мурадян Арам: новое событие");
    // У предметов со своей страницей ссылки прежние
    expect(pathOf({ taskNumber: 47, entryId: null })).toBe("/tasks/47");
    expect(pathOf({ taskNumber: null, entryId: null, requestNumber: 5 })).toBe("/requests/5");
  });

  it("служебный обработчик открывает очередь на «Моей неделе», когда адреса в уведомлении нет", () => {
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain('data.url || "/#me-queue"');
    expect(sw).toContain('event.notification.data.url) || "/#me-queue"');
    expect(sw).not.toMatch(/["']\/me["']/);
    expect(sw).not.toContain("«Мне»");
  });

  it("живое обновление очереди: «Моя неделя», адреса /me больше нет", () => {
    expect(relevant("inbox", "/")).toBe(true);
    expect(relevant("tasks", "/")).toBe(true);
    expect(relevant("inbox", "/me")).toBe(false);
  });

  it("строка «Не сдан weekly за неделю N» ведёт на сдачу за свой понедельник", () => {
    expect(submitWeekHref("2026-10-12")).toBe("/weekly/submit?week=2026-10-12");
  });
});

describe("функции, переехавшие из модуля один на один", () => {
  it("личный вход: общий логин team и неизвестный способ личным не считаются", () => {
    expect(personalLogin("PASSWORD")).toBe(true);
    expect(personalLogin("EMAIL")).toBe(true);
    expect(personalLogin("INVITE")).toBe(true);
    expect(personalLogin("TEAM")).toBe(false);
    expect(personalLogin(null)).toBe(false);
    expect(personalLogin(undefined)).toBe(false);
  });

  it("короткий текст одной строкой: без длинного тире и стрелок, пробелы схлопнуты, длина ограничена", () => {
    expect(cleanPhrase("  Бюджет —  на   ноябрь → обсудить ", 500)).toBe("Бюджет - на ноябрь - обсудить");
    expect(cleanPhrase("Первое\nвторое – третье", 500)).toBe("Первое второе - третье");
    expect(cleanPhrase("т".repeat(600), 120)).toHaveLength(120);
    expect(cleanPhrase(undefined, 10)).toBe("");
  });
});

/** Файлы кода без сгенерированного клиента Prisma */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sources(path);
    return /\.(tsx?|mjs)$/.test(name) ? [path] : [];
  });
}

describe("в коде нет ссылок на убранные разделы", () => {
  const files = sources("src").map((path) => ({ path, text: readFileSync(path, "utf8") }));

  it("ни одна ссылка не ведёт в /me или /one-on-one", () => {
    const toMe = /["'`]\/me(?:["'`#?/])/;
    const toOneOnOne = /\/one-on-one/;
    const bad = files.filter((f) => toMe.test(f.text) || toOneOnOne.test(f.text)).map((f) => f.path);
    expect(bad).toEqual([]);
  });

  it("модуля, страниц и таблиц один на один нет; пункта «Мне» в меню нет", () => {
    expect(files.some((f) => f.path.includes("one-on-one"))).toBe(false);
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).not.toMatch(/model OneOnOne/);
    expect(schema).not.toContain("one_on_one");
    const nav = files.find((f) => f.path.endsWith("shell/nav.tsx"))!.text;
    expect(nav).not.toMatch(/label: "Мне"/);
    expect(nav).not.toMatch(/label: "Один на один"/);
  });
});
