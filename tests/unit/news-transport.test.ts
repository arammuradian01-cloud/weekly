// Этап 60, проверка 21.10: защита забора лент от запросов во внутреннюю сеть. Без внешней сети: разрешение имён
// и запросы подменены, кроме проверки подключения к закреплённому адресу на локальном сервере
import { createServer, type Server } from "node:http";
import { deflateRawSync, deflateSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { FeedError, MESSAGES, addressBlocked, checkFeedUrl, decode, decompress, fakeFeedsOn, fetchFeed, nodeRequest, setNewsNetwork, type RawRequest, type RawResponse } from "@/lib/news/transport";

const RSS = '<?xml version="1.0"?><rss><channel><title>Лента</title><item><title>ОСАГО</title><link>https://feed.example/1</link></item></channel></rss>';
const ok = (body = RSS): RawResponse => ({ status: 200, headers: { contentType: "application/rss+xml; charset=utf-8" }, body: Buffer.from(body) });
const redirect = (location: string): RawResponse => ({ status: 302, headers: { location }, body: Buffer.alloc(0) });

/** Публичные имена разрешаются в публичный адрес, остальное по таблице */
function fakeNet(table: Record<string, string[]>, respond: (r: RawRequest) => RawResponse) {
  const lookups: string[] = [];
  const requests: RawRequest[] = [];
  setNewsNetwork({
    lookup: async (host) => {
      lookups.push(host);
      const list = table[host];
      if (!list) throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      return list.map((address) => ({ address, family: address.includes(":") ? (6 as const) : (4 as const) }));
    },
    request: async (r) => {
      requests.push(r);
      return respond(r);
    },
  });
  return { lookups, requests };
}

afterEach(() => setNewsNetwork(null));

describe("адрес ленты без сети", () => {
  it("внутренние имена и адреса, чужие схемы, порты и логины не принимаются", () => {
    const internal = [
      "http://localhost/rss",
      "http://localhost./rss",
      "http://api.localhost/rss",
      "http://metadata.internal/rss",
      "http://printer.local/rss",
      "http://router.home.arpa/rss",
      "http://intranet/rss",
      "http://127.0.0.1/rss",
      "http://127.1/rss",
      "http://2130706433/rss",
      "http://0x7f000001/rss",
      "http://10.1.2.3/rss",
      "http://172.20.0.1/rss",
      "http://192.168.1.1/rss",
      "http://169.254.169.254/latest/meta-data",
      "http://100.64.0.1/rss",
      "http://0.0.0.0/rss",
      "http://224.0.0.1/rss",
      "http://255.255.255.255/rss",
      "http://[::1]/rss",
      "http://[::]/rss",
      "http://[fc00::1]/rss",
      "http://[fd12:3456::1]/rss",
      "http://[fe80::1]/rss",
      "http://[::ffff:127.0.0.1]/rss",
      "http://[::ffff:10.0.0.1]/rss",
      "http://[64:ff9b::a00:1]/rss",
    ];
    for (const url of internal) expect(checkFeedUrl(url), url).toBe(MESSAGES.internal);
    expect(checkFeedUrl("http://feed.example:8080/rss")).toBe(MESSAGES.port);
    expect(checkFeedUrl("https://feed.example:22/rss")).toBe(MESSAGES.port);
    expect(checkFeedUrl("ftp://feed.example/rss")).toBe(MESSAGES.scheme);
    expect(checkFeedUrl("file:///etc/passwd")).toBe(MESSAGES.scheme);
    expect(checkFeedUrl("gopher://feed.example/")).toBe(MESSAGES.scheme);
    expect(checkFeedUrl("не адрес")).toBe(MESSAGES.scheme);
    expect(checkFeedUrl("https://user:pass@feed.example/rss")).toBe(MESSAGES.credentials);
  });

  it("публичные адреса и стандартные порты проходят", () => {
    for (const url of ["https://www.cbr.ru/rss/RssPress", "http://feed.example:80/rss", "https://feed.example:443/rss", "http://feed.example:443/rss", "https://93.184.216.34/rss", "https://[2a00:1450:4010:c05::64]/rss"]) {
      expect(checkFeedUrl(url), url).toBeNull();
    }
  });

  it("проверка адресов: IPv4, IPv6, IPv4 внутри IPv6", () => {
    expect(addressBlocked("8.8.8.8")).toBe(false);
    expect(addressBlocked("172.32.0.1")).toBe(false);
    expect(addressBlocked("100.128.0.1")).toBe(false);
    expect(addressBlocked("2a00:1450:4010:c05::64")).toBe(false);
    expect(addressBlocked("::ffff:7f00:1")).toBe(true);
    expect(addressBlocked("::ffff:8.8.8.8")).toBe(true);
    expect(addressBlocked("fe80::1%eth0")).toBe(true);
    expect(addressBlocked("ff02::1")).toBe(true);
    expect(addressBlocked("не адрес")).toBe(true);
  });

  it("IPv6 по белому списку: только глобальный unicast 2000::/3 без особых диапазонов", () => {
    for (const ip of ["2a00:1450:4010:c05::64", "2606:4700::1111", "2001:4860:4860::8888", "2a02:6b8::2:242"]) expect(addressBlocked(ip), ip).toBe(false);
    for (const ip of [
      "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo
      "2001:db8::1", // документация
      "2002:c000:204::1", // 6to4
      "64:ff9b::808:808", // NAT64
      "64:ff9b:1::1", // локальный NAT64
      "::ffff:0:a00:1", // SIIT ::ffff:0:10.0.0.1
      "::ffff:0:7f00:1",
      "fec0::1", // site-local
      "100::1", // discard
      "fd00::1",
      "fe80::1",
      "::1",
      "::",
      "ff02::1",
      "3fff::1",
      "4000::1", // вне 2000::/3
    ]) {
      expect(addressBlocked(ip), ip).toBe(true);
    }
  });
});

describe("забор с проверкой каждого шага", () => {
  it("редирект на 127.0.0.1 не выполняется", async () => {
    const net = fakeNet({ "feed.example": ["93.184.216.34"] }, () => redirect("http://127.0.0.1/admin"));
    await expect(fetchFeed({ url: "https://feed.example/rss" })).rejects.toThrow(MESSAGES.internal);
    expect(net.requests).toHaveLength(1);
    expect(net.requests[0]!.address).toBe("93.184.216.34");
  });

  it("редирект на имя, которое разрешается во внутренний адрес, тоже не выполняется", async () => {
    const net = fakeNet({ "feed.example": ["93.184.216.34"], "evil.example": ["93.184.216.35", "10.0.0.1"] }, () => redirect("https://evil.example/x"));
    await expect(fetchFeed({ url: "https://feed.example/rss" })).rejects.toThrow(MESSAGES.internal);
    expect(net.lookups).toEqual(["feed.example", "evil.example"]);
    expect(net.requests).toHaveLength(1);
  });

  it("имя, которое разрешается в 10.0.0.1: подключения нет", async () => {
    const net = fakeNet({ "feed.example": ["10.0.0.1"] }, () => ok());
    await expect(fetchFeed({ url: "https://feed.example/rss" })).rejects.toThrow(MESSAGES.internal);
    expect(net.requests).toHaveLength(0);
  });

  it("порт 8080: ни разрешения имени, ни подключения", async () => {
    const net = fakeNet({ "feed.example": ["93.184.216.34"] }, () => ok());
    await expect(fetchFeed({ url: "http://feed.example:8080/rss" })).rejects.toThrow(MESSAGES.port);
    expect(net.lookups).toHaveLength(0);
    expect(net.requests).toHaveLength(0);
    // И редиректом на порт 8080
    fakeNet({ "feed.example": ["93.184.216.34"] }, () => redirect("http://feed.example:8080/rss"));
    await expect(fetchFeed({ url: "https://feed.example/rss" })).rejects.toThrow(MESSAGES.port);
  });

  it("IPv6 ::1 адресом и через DNS, IPv4 внутри IPv6 через DNS", async () => {
    const net = fakeNet({ "six.example": ["::1"], "mapped.example": ["::ffff:127.0.0.1"] }, () => ok());
    await expect(fetchFeed({ url: "http://[::1]/rss" })).rejects.toThrow(MESSAGES.internal);
    await expect(fetchFeed({ url: "https://six.example/rss" })).rejects.toThrow(MESSAGES.internal);
    await expect(fetchFeed({ url: "https://mapped.example/rss" })).rejects.toThrow(MESSAGES.internal);
    expect(net.requests).toHaveLength(0);
  });

  it("подключение идёт к проверенному адресу, переадресаций не больше трёх", async () => {
    let n = 0;
    const net = fakeNet({ "feed.example": ["93.184.216.34"], "cdn.example": ["93.184.216.40"] }, () => (++n <= 3 ? redirect(n === 1 ? "https://cdn.example/a" : `/hop${n}`) : ok()));
    const r = await fetchFeed({ url: "https://feed.example/rss", etag: '"v1"' });
    expect(r.status).toBe(200);
    expect(r.body).toContain("<title>Лента</title>");
    expect(net.requests.map((q) => [q.url.toString(), q.address])).toEqual([
      ["https://feed.example/rss", "93.184.216.34"],
      ["https://cdn.example/a", "93.184.216.40"],
      ["https://cdn.example/hop2", "93.184.216.40"],
      ["https://cdn.example/hop3", "93.184.216.40"],
    ]);
    // Имя разрешается на каждом шаге заново
    expect(net.lookups).toEqual(["feed.example", "cdn.example", "cdn.example", "cdn.example"]);
    expect(net.requests[0]!.headers["if-none-match"]).toBe('"v1"');

    fakeNet({ "feed.example": ["93.184.216.34"] }, () => redirect("/again"));
    await expect(fetchFeed({ url: "https://feed.example/rss" })).rejects.toThrow(MESSAGES.redirects);
  });

  it("сетевые ошибки без подробностей: «Источник недоступен», 404 и 304 как есть", async () => {
    fakeNet({}, () => ok());
    await expect(fetchFeed({ url: "https://nowhere.example/rss" }, { deadline: Date.now() + 1000 })).rejects.toThrow(/^Источник недоступен$/);
    setNewsNetwork({
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => {
        throw Object.assign(new Error("connect ECONNREFUSED 93.184.216.34:443"), { code: "ECONNREFUSED" });
      },
    });
    await expect(fetchFeed({ url: "https://feed.example/rss" }, { deadline: Date.now() + 1000 })).rejects.toThrow(/^Источник недоступен$/);
    fakeNet({ "feed.example": ["93.184.216.34"] }, () => ({ status: 404, headers: {}, body: Buffer.alloc(0) }));
    await expect(fetchFeed({ url: "https://feed.example/rss" })).rejects.toThrow("Сервер ответил 404");
    fakeNet({ "feed.example": ["93.184.216.34"] }, () => ({ status: 304, headers: {}, body: Buffer.alloc(0) }));
    expect(await fetchFeed({ url: "https://feed.example/rss", etag: '"v1"' })).toMatchObject({ status: 304, etag: '"v1"' });
  });

  it("DNS не дольше срока: зависшее разрешение имени обрывается общим сроком, и это не сбой источника", async () => {
    setNewsNetwork({ lookup: () => new Promise(() => undefined), request: async () => ok() });
    const t = Date.now();
    const error = await fetchFeed({ url: "https://feed.example/rss" }, { deadline: Date.now() + 300 }).catch((e: unknown) => e);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(error).toBeInstanceOf(FeedError);
    expect((error as FeedError).budget).toBe(true);
    expect((error as FeedError).message).toBe(MESSAGES.budget);
  });

  it("запросу отдаются все проверенные адреса имени", async () => {
    const net = fakeNet({ "feed.example": ["93.184.216.34", "2a00:1450:4010:c05::64"] }, () => ok());
    await fetchFeed({ url: "https://feed.example/rss" });
    expect(net.requests[0]!.addresses).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2a00:1450:4010:c05::64", family: 6 },
    ]);
  });

  it("фикстуры NEWS_FAKE не действуют в боевом режиме без WEEKLY_E2E", () => {
    expect(fakeFeedsOn({ NEWS_FAKE: "1", NODE_ENV: "test" })).toBe(true);
    expect(fakeFeedsOn({ NEWS_FAKE: "1", NODE_ENV: "development" })).toBe(true);
    expect(fakeFeedsOn({ NEWS_FAKE: "1", NODE_ENV: "production" })).toBe(false);
    expect(fakeFeedsOn({ NEWS_FAKE: "1", NODE_ENV: "production", WEEKLY_E2E: "1" })).toBe(true);
    expect(fakeFeedsOn({ NODE_ENV: "test" })).toBe(false);
  });
});

describe("кодировки и сжатие", () => {
  it("charset в кавычках, объявление XML, UTF-16 с меткой BOM", () => {
    const cp1251 = Buffer.from([0xce, 0xd1, 0xc0, 0xc3, 0xce]); // «ОСАГО» в windows-1251
    expect(decode(cp1251, 'text/xml; charset="windows-1251"')).toBe("ОСАГО");
    expect(decode(cp1251, "text/xml; charset='windows-1251'")).toBe("ОСАГО");
    expect(decode(Buffer.concat([Buffer.from('<?xml version="1.0" encoding="windows-1251"?>'), cp1251]), null)).toContain("ОСАГО");
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<rss>ОСАГО</rss>", "utf16le")]);
    expect(decode(le, "text/xml; charset=utf-8")).toBe("<rss>ОСАГО</rss>");
    const be = Buffer.from("<rss>КАСКО</rss>", "utf16le").swap16();
    expect(decode(Buffer.concat([Buffer.from([0xfe, 0xff]), be]), null)).toBe("<rss>КАСКО</rss>");
    expect(decode(Buffer.from("\ufeff<rss/>"), null)).toBe("<rss/>");
  });

  it("deflate с заголовком zlib и без него, двойной gzip, бомба сжатия", () => {
    const body = Buffer.from(RSS);
    expect(decompress(deflateSync(body), "deflate").toString()).toBe(RSS);
    expect(decompress(deflateRawSync(body), "deflate").toString()).toBe(RSS);
    expect(decompress(gzipSync(gzipSync(body)), "gzip, gzip").toString()).toBe(RSS);
    expect(decompress(body, "identity").toString()).toBe(RSS);
    expect(() => decompress(gzipSync(Buffer.alloc(6 * 1024 * 1024)), "gzip")).toThrow(MESSAGES.tooBig);
    expect(() => decompress(body, "compress")).toThrow(MESSAGES.broken);
  });
});

describe("подключение к закреплённому адресу", () => {
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  it("имя не разрешается повторно: запрос уходит на проверенный адрес с исходным Host, gzip распаковывается", async () => {
    let host = "";
    server = createServer((req, res) => {
      host = req.headers.host ?? "";
      res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8", "content-encoding": "gzip", etag: '"e1"' });
      res.end(gzipSync(Buffer.from(RSS)));
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    // Имя feed.invalid не существует: ответ возможен только при подключении к закреплённому адресу
    const r = await nodeRequest({ url: new URL(`http://feed.invalid:${port}/rss`), address: "127.0.0.1", family: 4, addresses: [{ address: "127.0.0.1", family: 4 }], headers: { "accept-encoding": "gzip" }, timeoutMs: 5000 });
    expect(r.status).toBe(200);
    expect(r.headers.etag).toBe('"e1"');
    expect(r.body.toString("utf8")).toBe(RSS);
    expect(host).toBe(`feed.invalid:${port}`);
  });

  it("недоступный первый проверенный адрес: подключение идёт к следующему", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/xml" });
      res.end(RSS);
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    // На ::1 этот порт никто не слушает (или IPv6 нет вовсе): подключение уходит на 127.0.0.1
    const r = await nodeRequest({ url: new URL(`http://feed.invalid:${port}/rss`), address: "::1", family: 6, addresses: [{ address: "::1", family: 6 }, { address: "127.0.0.1", family: 4 }], headers: {}, timeoutMs: 5000 });
    expect(r.status).toBe(200);
  });

  it("тело больше предела обрывается", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/xml" });
      const chunk = Buffer.alloc(1024 * 1024, 32);
      for (let i = 0; i < 6; i++) res.write(chunk);
      res.end();
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    await expect(nodeRequest({ url: new URL(`http://feed.invalid:${port}/rss`), address: "127.0.0.1", family: 4, addresses: [{ address: "127.0.0.1", family: 4 }], headers: {}, timeoutMs: 5000 })).rejects.toThrow(MESSAGES.tooBig);
  });
});
