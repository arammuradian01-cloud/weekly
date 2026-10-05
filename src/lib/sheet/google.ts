// Настоящий клиент Google Sheets API через служебный аккаунт.
// Ключ служебного аккаунта лежит только в переменной окружения GOOGLE_SERVICE_ACCOUNT_JSON (JSON или base64 от него).
// В базу, журнал, чат и репозиторий ключ не попадает.

import { SignJWT, importPKCS8 } from "jose";
import { PROD_SHEET_ID, q, type Grid, type SheetInfo, type SheetsClient } from "./client";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

/** Служебный аккаунт из окружения или null, если его не задали */
export function serviceAccountFromEnv(env: Record<string, string | undefined> = process.env): ServiceAccount | null {
  const raw = (env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (!raw) return null;
  const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  try {
    const sa = JSON.parse(text) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    return sa;
  } catch {
    return null;
  }
}

/** Короткая причина из ответа Google: поле error.message, иначе начало текста одной строкой */
export function googleDetail(text: string): string {
  try {
    const message = (JSON.parse(text) as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string" && message.trim()) return `Google: ${message.trim()}`;
  } catch {
    // не JSON: ниже берём сам текст
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

export class GoogleSheetsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class GoogleSheets implements SheetsClient {
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly spreadsheetId: string,
    private readonly account: ServiceAccount,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    // Второй рубеж после проверки ссылки: в рабочую таблицу этот код не пишет, откуда бы ни пришёл её ID
    if (spreadsheetId === PROD_SHEET_ID) throw new GoogleSheetsError("Рабочая таблица подключается только на этапе 7", 0);
  }

  get email() {
    return this.account.client_email;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now() + 60_000) return this.token.value;
    const aud = this.account.token_uri ?? "https://oauth2.googleapis.com/token";
    const key = await importPKCS8(this.account.private_key.replace(/\\n/g, "\n"), "RS256");
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.account.client_email)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);
    const res = await this.fetchImpl(aud, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new GoogleSheetsError(`Google не выдал доступ служебному аккаунту (${res.status})`, res.status);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, until: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(`${API}/${this.spreadsheetId}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    const res = await this.fetchImpl(url, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const message =
        res.status === 403 && /protected/i.test(text)
          ? "Вкладка защищена от правок служебного аккаунта: владелец таблицы должен снять старую защиту (Данные, Защищённые листы и диапазоны)"
          : res.status === 403
          ? "Нет доступа к таблице: дайте служебному аккаунту права редактора на копию"
          : res.status === 404
            ? "Таблица не найдена: проверьте ID таблицы"
            : `Google Sheets ответил ${res.status}`;
      throw new GoogleSheetsError(`${message}. ${googleDetail(text)}`.trim(), res.status);
    }
    return (await res.json()) as T;
  }

  async sheets(): Promise<SheetInfo[]> {
    type Raw = {
      properties: { title: string; sheetId: number; hidden?: boolean; gridProperties?: { rowCount?: number; columnCount?: number } };
      protectedRanges?: { protectedRangeId: number; description?: string }[];
      conditionalFormats?: unknown[];
    };
    const body = await this.call<{ sheets?: Raw[] }>("", {
      query: { fields: "sheets(properties(title,sheetId,hidden,gridProperties(rowCount,columnCount)),protectedRanges(protectedRangeId,description),conditionalFormats(ranges))" },
    });
    return (body.sheets ?? []).map((s) => ({
      title: s.properties.title,
      sheetId: s.properties.sheetId,
      hidden: s.properties.hidden,
      rowCount: s.properties.gridProperties?.rowCount,
      columnCount: s.properties.gridProperties?.columnCount,
      protectedRanges: (s.protectedRanges ?? []).map((p) => ({ id: p.protectedRangeId, description: p.description })),
      conditionalFormats: s.conditionalFormats?.length ?? 0,
    }));
  }

  async batchUpdate(requests: Record<string, unknown>[]): Promise<void> {
    if (!requests.length) return;
    await this.call(":batchUpdate", { method: "POST", body: { requests } });
  }

  async getValues(range: string): Promise<Grid> {
    const body = await this.call<{ values?: Grid }>(`/values/${encodeURIComponent(range)}`, {
      query: { valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER", majorDimension: "ROWS" },
    });
    return body.values ?? [];
  }

  async setValues(data: { range: string; values: Grid }[]): Promise<void> {
    if (!data.length) return;
    await this.call("/values:batchUpdate", { method: "POST", body: { valueInputOption: "RAW", data } });
  }

  async setFormulas(range: string, values: Grid): Promise<void> {
    await this.call(`/values/${encodeURIComponent(range)}`, { method: "PUT", query: { valueInputOption: "USER_ENTERED" }, body: { values } });
  }

  async append(sheet: string, values: Grid): Promise<void> {
    if (!values.length) return;
    await this.call(`/values/${encodeURIComponent(`${q(sheet)}!A1`)}:append`, {
      method: "POST",
      // OVERWRITE: строки пишутся в пустые размеченные строки под таблицей. INSERT_ROWS вставлял бы новые строки,
      // и они брали бы оформление шапки: жирный шрифт, даты числами, сдвиг условного форматирования
      query: { valueInputOption: "RAW", insertDataOption: "OVERWRITE" },
      body: { values },
    });
  }

  async clear(range: string): Promise<void> {
    await this.call(`/values/${encodeURIComponent(range)}:clear`, { method: "POST", body: {} });
  }
}
