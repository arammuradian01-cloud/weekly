// Этап 60: разбор лент RSS и Atom из фикстур, без сети
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanText, decodeEntities, parseDate, parseFeed, urlKeyOf } from "@/lib/news/feed";

const fixture = (name: string) => readFileSync(`tests/fixtures/news/${name}`, "utf8");

describe("разбор RSS 2.0", () => {
  const feed = parseFeed(fixture("cbr.ru.xml"));

  it("заголовок ленты и записи с заголовком и ссылкой, запись без ссылки пропускается", () => {
    expect(feed.title).toBe("Банк России: пресс-релизы");
    expect(feed.items.map((i) => i.guid)).toEqual(["cbr-10001", "cbr-10002", "cbr-10004", "cbr-9000"]);
  });

  it("CDATA, разметка и сущности сняты, длинное тире стало дефисом, ссылка раскодирована", () => {
    const first = feed.items[0]!;
    expect(first.title).toBe("Банк России обсудил со страховщиками изменения в тарифах ОСАГО");
    expect(first.url).toBe("https://www.cbr.ru/press/event/?id=10001&utm_source=rss");
    expect(first.description).toBe("Регулятор рассмотрел предложения РСА по расширению тарифного коридора - решение будет принято в ноябре. Также обсуждались сроки европротокола.");
    expect(first.description).not.toContain("—");
  });

  it("даты: со смещением и со словом MSK", () => {
    expect(feed.items[0]!.publishedAt?.toISOString()).toBe("2026-10-20T07:30:00.000Z");
    expect(feed.items[2]!.publishedAt?.toISOString()).toBe("2026-10-19T06:00:00.000Z");
    expect(parseDate("не дата")).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe("разбор Atom", () => {
  const feed = parseFeed(fixture("asn-news.ru.xml"));

  it("записи entry, ссылка rel=alternate, а не enclosure, id как guid", () => {
    expect(feed.title).toBe("АСН");
    expect(feed.items).toHaveLength(3);
    expect(feed.items[0]).toMatchObject({ guid: "tag:asn-news.ru,2026:1", url: "https://www.asn-news.ru/news/1?utm_campaign=rss", title: "Страховщики подвели итоги продаж КАСКО за квартал" });
    expect(feed.items[0]!.description).toBe("Сборы по каско выросли, угоны сократились.");
    expect(feed.items[0]!.publishedAt?.toISOString()).toBe("2026-10-21T04:15:00.000Z");
  });

  it("без published берётся updated, content вместо summary", () => {
    expect(feed.items[1]!.publishedAt?.toISOString()).toBe("2026-10-20T08:00:00.000Z");
    expect(feed.items[1]!.description).toContain("Перепечатка пресс-релиза");
  });
});

describe("не лента", () => {
  it("HTML-страница даёт пустой список", () => {
    expect(parseFeed(fixture("broken.example.xml")).items).toEqual([]);
    expect(parseFeed("").items).toEqual([]);
  });
});

describe("служебные функции", () => {
  it("сущности: именованные, десятичные, шестнадцатеричные", () => {
    expect(decodeEntities("&laquo;ОСАГО&raquo; &amp; &#1050;&#x410;&#x421;&#x41A;&#x41E; &mdash; да")).toBe("«ОСАГО» & КАСКО - да");
  });

  it("cleanText снимает теги и схлопывает пробелы", () => {
    expect(cleanText("<p>Раз</p>\n\n<p>Два&nbsp;три</p>")).toBe("Раз Два три");
  });

  it("ключ адреса: без схемы, www, utm-меток, якоря и завершающего слэша, параметры по алфавиту", () => {
    expect(urlKeyOf("https://www.cbr.ru/press/event/?id=10001&utm_source=rss#top")).toBe("cbr.ru/press/event?id=10001");
    expect(urlKeyOf("http://cbr.ru/press/event/?utm_medium=x&id=10001")).toBe("cbr.ru/press/event?id=10001");
    expect(urlKeyOf("https://site.ru/b/?z=1&a=2")).toBe("site.ru/b?a=2&z=1");
    expect(urlKeyOf("https://site.ru")).toBe("site.ru/");
    expect(urlKeyOf("не адрес")).toBe("не адрес");
  });
});
