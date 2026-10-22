// Этап 60: разбор лент RSS и Atom из фикстур, без сети
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_FEED_ITEMS, cleanText, decodeEntities, parseDate, parseFeed, urlKeyOf } from "@/lib/news/feed";

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

  it("дата без часового пояса читается как UTC, пояс словом GMT+3 понимается", () => {
    expect(parseDate("2026-10-20T10:30:00")?.toISOString()).toBe("2026-10-20T10:30:00.000Z");
    expect(parseDate("2026-10-20 10:30")?.toISOString()).toBe("2026-10-20T10:30:00.000Z");
    expect(parseDate("Tue, 20 Oct 2026 10:30:00")?.toISOString()).toBe("2026-10-20T10:30:00.000Z");
    expect(parseDate("Tue, 20 Oct 2026 10:30:00 GMT+3")?.toISOString()).toBe("2026-10-20T07:30:00.000Z");
    expect(parseDate("Tue, 20 Oct 2026 10:30:00 GMT+03:00")?.toISOString()).toBe("2026-10-20T07:30:00.000Z");
    expect(parseDate("2026-10-20T10:30:00+03:00")?.toISOString()).toBe("2026-10-20T07:30:00.000Z");
    expect(parseDate("2026-10-20")?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
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

describe("патологические ленты: разбор линейный, веб-процесс не зависает", () => {
  const head = '<?xml version="1.0"?><rss version="2.0"><channel><title>Лента</title>';
  const timed = (xml: string) => {
    const t = performance.now();
    const feed = parseFeed(xml);
    return { feed, ms: performance.now() - t };
  };

  it("незакрытые item на 500 КБ разбираются меньше чем за секунду", () => {
    const xml = head + "<item><title>Страхование".repeat(Math.ceil(500_000 / 24));
    expect(xml.length).toBeGreaterThan(500_000);
    const { feed, ms } = timed(xml);
    expect(ms).toBeLessThan(1000);
    expect(feed.title).toBe("Лента");
    expect(feed.items).toEqual([]);
  });

  it("незакрытые теги, одиночные скобки, CDATA и комментарии без конца не тянут разбор", () => {
    for (const filler of ["<title>а", "<", "< a", "<![CDATA[x", "<!-- x", "&#x41", "<item><link>https://x.ru/", "<a<b<c"]) {
      const xml = head + "<item><title>Новость</title><link>https://x.ru/1</link><description>" + filler.repeat(Math.ceil(400_000 / filler.length));
      const { ms } = timed(xml);
      expect(ms, filler).toBeLessThan(1000);
    }
  });

  it("лента на 8000 записей: берутся первые 200, быстро", () => {
    const items = Array.from({ length: 8000 }, (_, i) => `<item><title>Новость про ОСАГО ${i}</title><link>https://x.ru/${i}</link><guid>g${i}</guid><pubDate>Tue, 20 Oct 2026 10:30:00 +0300</pubDate><description>Анонс ${i}</description></item>`).join("");
    const { feed, ms } = timed(head + items + "</channel></rss>");
    expect(ms).toBeLessThan(1000);
    expect(feed.items).toHaveLength(MAX_FEED_ITEMS);
    expect(feed.items[0]).toMatchObject({ guid: "g0", url: "https://x.ru/0", title: "Новость про ОСАГО 0", description: "Анонс 0" });
    expect(feed.items[199]!.guid).toBe("g199");
  });

  it("незакрытая запись кончается там, где начинается следующая; разбор не дальше 1 МБ", () => {
    const xml = head + "<item><title>Первая</title><link>https://x.ru/1</link><item><title>Вторая</title><link>https://x.ru/2</link></item>";
    expect(parseFeed(xml).items.map((i) => i.title)).toEqual(["Первая", "Вторая"]);
    const big = head + "<item><title>Ранняя</title><link>https://x.ru/1</link></item>" + " ".repeat(1_100_000) + "<item><title>Поздняя</title><link>https://x.ru/2</link></item>";
    expect(parseFeed(big).items.map((i) => i.title)).toEqual(["Ранняя"]);
  });

  it("заголовок ленты берётся до первой записи, а не из записей", () => {
    const xml = '<rss><channel><item><title>Запись</title><link>https://x.ru/1</link></item><title>Поздний заголовок</title></channel></rss>';
    expect(parseFeed(xml).title).toBe("");
    expect(parseFeed(xml).items[0]!.title).toBe("Запись");
  });

  it("сущности DTD не раскрываются", () => {
    const xml = '<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;">]><rss><channel><item><title>Тест &b;</title><link>https://x.ru/1</link></item></channel></rss>';
    expect(parseFeed(xml).items[0]!.title).toBe("Тест &b;");
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
