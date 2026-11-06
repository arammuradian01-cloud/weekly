import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { S3BackupStore } from "../../scripts/lib/remote-backup/storage";

// Настоящий SDK и HTTP-потоки, локальная имитация S3. Ни ключей, ни запросов во внешнее хранилище.
let server: Server;
let store: S3BackupStore;
let dir: string;
const objects = new Map<string, Buffer>();
let sawConditionalPut = false;
let listPages = 0;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "weekly-s3-test-"));
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const key = decodeURIComponent(url.pathname.replace(/^\/weekly-test\//, ""));
    if (req.method === "PUT") {
      sawConditionalPut = req.headers["if-none-match"] === "*";
      if (objects.has(key)) { res.writeHead(412); res.end("<Error><Code>PreconditionFailed</Code></Error>"); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
      res.writeHead(200, { ETag: '"synthetic"' }); res.end();
    } else if (req.method === "GET" && url.searchParams.has("list-type")) {
      listPages++;
      const keys = [...objects.keys()].filter((k) => k.startsWith(url.searchParams.get("prefix") ?? "")).sort();
      const start = Number(url.searchParams.get("continuation-token") ?? 0);
      const selected = keys.slice(start, start + 1);
      const more = start + 1 < keys.length;
      res.setHeader("Content-Type", "application/xml");
      res.end(`<ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 1}</NextContinuationToken>` : ""}${selected.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`);
    } else if (req.method === "GET") {
      const value = objects.get(key);
      res.writeHead(value ? 200 : 404); res.end(value ?? "<Error><Code>NoSuchKey</Code></Error>");
    } else if (req.method === "DELETE") { objects.delete(key); res.writeHead(204); res.end(); }
    else { res.writeHead(400); res.end(); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test server");
  // HTTP допустим только в этой напрямую переданной тестовой конфигурации; production config требует HTTPS.
  store = new S3BackupStore({ databaseUrl: "postgresql://unused/unused", endpoint: `http://127.0.0.1:${address.port}`, region: "test",
    bucket: "weekly-test", prefix: "weekly", accessKeyId: "synthetic", secretAccessKey: "synthetic", encryptionKey: randomBytes(32), keepDaily: 2, keepMonthly: 2, keepMigration: 2 });
});
afterAll(async () => { if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } if (dir) await rm(dir, { recursive: true, force: true }); });
it("загружает и скачивает поток, запрещает перезапись, читает все страницы и удаляет только свой префикс", async () => {
  const source = join(dir, "source");
  const data = randomBytes(128_000);
  await writeFile(source, data);
  await store.put("weekly/daily/one.wbk", source);
  expect(sawConditionalPut).toBe(true);
  await expect(store.put("weekly/daily/one.wbk", source)).rejects.toThrow();
  await store.get("weekly/daily/one.wbk", join(dir, "download"));
  expect(await readFile(join(dir, "download"))).toEqual(data);
  await store.put("weekly/daily/two.wbk", source);
  expect(await store.list("weekly/daily/")).toEqual(["weekly/daily/one.wbk", "weekly/daily/two.wbk"]);
  expect(listPages).toBe(2);
  await expect(store.remove("other/daily/one.wbk")).rejects.toThrow("вне префикса");
  await store.remove("weekly/daily/one.wbk");
  expect(await store.list("weekly/daily/")).toEqual(["weekly/daily/two.wbk"]);
  await expect(store.get("weekly/daily/missing.wbk", join(dir, "missing"))).rejects.toThrow();
});
