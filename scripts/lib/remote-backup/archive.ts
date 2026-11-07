import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("WEEKLYBK1");
const HEADER_SIZE = MAGIC.length + 12;
const TAG_SIZE = 16;
const MAX_MANIFEST = 4 * 1024 * 1024;
export type TableDigest = { schema: string; table: string; rows: number; sha256: string };
export type Manifest = {
  version: 1;
  createdAt: string;
  database: string;
  purpose: "daily" | "migration";
  dumpSha256: string;
  tables: TableDigest[];
};

export async function fileHash(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Один аутентифицированный архив: паспорт снимка и pg_dump зашифрованы вместе. */
export async function encryptArchive(dump: string, output: string, manifest: Manifest, key: Buffer): Promise<void> {
  const json = Buffer.from(JSON.stringify(manifest));
  if (json.length > MAX_MANIFEST) throw new Error("Паспорт резервной копии слишком велик");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(json.length);
  const header = Buffer.concat([MAGIC, randomBytes(12)]);
  const cipher = createCipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
  cipher.setAAD(header);
  const input = Readable.from((async function* () {
    yield size;
    yield json;
    yield* createReadStream(dump);
  })());
  const encrypted = input.pipe(cipher);
  // pipe сам не передаёт ошибку источника дальше.
  input.on("error", (error) => cipher.destroy(error));
  try {
    await pipeline(Readable.from((async function* () {
      yield header;
      yield* encrypted;
      yield cipher.getAuthTag();
    })()), createWriteStream(output, { flags: "wx", mode: 0o600 }));
  } finally {
    input.destroy();
    cipher.destroy();
  }
}

function parseManifest(data: Buffer): Manifest {
  const m = JSON.parse(data.toString("utf8")) as Manifest;
  const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  if (m.version !== 1 || typeof m.createdAt !== "string" || !Number.isFinite(Date.parse(m.createdAt)) ||
      typeof m.database !== "string" || !["daily", "migration"].includes(m.purpose) || !hash(m.dumpSha256) ||
      !Array.isArray(m.tables) || m.tables.length === 0 || m.tables.some((t) => !t || typeof t.schema !== "string" ||
        typeof t.table !== "string" || !Number.isSafeInteger(t.rows) || t.rows < 0 || !hash(t.sha256))) {
    throw new Error("Некорректный паспорт резервной копии");
  }
  return m;
}

/** До проверки GCM и SHA-256 pg_restore не получает ни одного байта. */
export async function decryptArchive(archive: string, dump: string, key: Buffer): Promise<Manifest> {
  const payload = `${dump}.payload`;
  const file = await open(archive, "r");
  let madePayload = false;
  let madeDump = false;
  try {
    const bytes = (await file.stat()).size;
    if (bytes <= HEADER_SIZE + TAG_SIZE + 4) throw new Error("Архив обрезан");
    const header = Buffer.alloc(HEADER_SIZE);
    const tag = Buffer.alloc(TAG_SIZE);
    await file.read(header, 0, header.length, 0);
    await file.read(tag, 0, tag.length, bytes - TAG_SIZE);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Неизвестный формат резервной копии");
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    const out = await open(payload, "wx", 0o600);
    madePayload = true;
    await pipeline(createReadStream(archive, { start: HEADER_SIZE, end: bytes - TAG_SIZE - 1 }), decipher, out.createWriteStream());
    const plain = await open(payload, "r");
    let manifest: Manifest;
    let offset: number;
    try {
      const prefix = Buffer.alloc(4);
      if ((await plain.read(prefix, 0, 4, 0)).bytesRead !== 4) throw new Error("Паспорт копии обрезан");
      const size = prefix.readUInt32BE();
      if (size < 2 || size > MAX_MANIFEST || size + 4 >= (await stat(payload)).size) throw new Error("Некорректная длина паспорта копии");
      const json = Buffer.alloc(size);
      if ((await plain.read(json, 0, size, 4)).bytesRead !== size) throw new Error("Паспорт копии обрезан");
      manifest = parseManifest(json);
      offset = size + 4;
    } finally { await plain.close(); }
    const output = await open(dump, "wx", 0o600);
    madeDump = true;
    await pipeline(createReadStream(payload, { start: offset }), output.createWriteStream());
    if (await fileHash(dump) !== manifest.dumpSha256) throw new Error("Контрольная сумма выгрузки не совпала");
    return manifest;
  } catch (error) {
    if (madeDump) await unlink(dump).catch(() => undefined);
    throw error;
  } finally {
    await file.close();
    if (madePayload) await unlink(payload);
  }
}
