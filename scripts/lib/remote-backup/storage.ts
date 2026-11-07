import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { BackupConfig } from "./config";

export interface BackupStore {
  put(key: string, file: string): Promise<void>;
  get(key: string, file: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
}

/** Для совместимого S3: собственный SHA-256 проверяется после скачивания; ACL не меняется. */
export class S3BackupStore implements BackupStore {
  private readonly client: S3Client;
  constructor(private readonly config: BackupConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint, region: config.region, forcePathStyle: true, maxAttempts: 3,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  private key(key: string): void {
    if (!key.startsWith(`${this.config.prefix}/`) || key.includes("..")) throw new Error("Ключ находится вне префикса резервных копий");
  }
  async put(key: string, file: string): Promise<void> {
    this.key(key);
    const size = (await stat(file)).size;
    if (size > 5 * 1024 ** 3) throw new Error("Копия превышает предел одной загрузки 5 ГиБ");
    const body = createReadStream(file);
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body,
        ContentLength: size, ContentType: "application/octet-stream", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(600_000) });
    } finally { body.destroy(); }
  }
  async get(key: string, file: string): Promise<void> {
    this.key(key);
    const signal = AbortSignal.timeout(600_000);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: signal });
    if (!(response.Body instanceof Readable)) throw new Error("Хранилище не вернуло файл копии");
    await pipeline(response.Body, createWriteStream(file, { flags: "wx", mode: 0o600 }), { signal });
  }
  async list(prefix: string): Promise<string[]> {
    this.key(prefix);
    const keys: string[] = [];
    const tokens = new Set<string>();
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: prefix,
        ContinuationToken: token }), { abortSignal: AbortSignal.timeout(60_000) });
      for (const object of page.Contents ?? []) if (object.Key?.startsWith(prefix)) keys.push(object.Key);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && (!token || tokens.has(token))) throw new Error("Хранилище не завершило список копий");
      if (token) tokens.add(token);
    } while (token);
    return keys.sort();
  }
  async remove(key: string): Promise<void> {
    this.key(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: AbortSignal.timeout(60_000) });
  }
}
