// Черновик weekly без сети (этап 26, модуль М11). Только браузер: localStorage этого устройства.
//
// Каждая правка записи и главной фразы сначала ложится сюда, потом уходит на сервер. Нет сети или сервер не ответил:
// черновик остаётся здесь и отправляется, когда связь появится, в том числе после перезагрузки страницы.
// Повтор безопасен: новая запись уходит с ключом черновика (clientKey), сервер правит уже созданную, а не плодит вторую.
// Черновики лежат под логином человека и стираются при выходе: на общем устройстве их не увидит следующий.

export type DraftEntryInput = {
  week: string;
  direction: string;
  block: string;
  type: string;
  what: string;
  details?: string;
  impact?: string;
  fact?: string;
  next?: string;
  help?: string;
  links: { title: string; url: string }[];
};

export type EntryDraft = {
  /** Ключ черновика: для новой записи случайный, для записи с сервера её id */
  key: string;
  /** id записи на сервере или null, пока запись не дошла */
  entryId: string | null;
  /** Ключ новой записи для сервера: повтор правит ту же запись */
  clientKey: string | null;
  input: DraftEntryInput;
  savedAt: number;
};

export type HeadlineDraft = { week: string; value: string; savedAt: number };

type Store = { v: 1; entries: Record<string, EntryDraft>; headlines: Record<string, HeadlineDraft> };

const PREFIX = "weekly-offline:v1:";
/** Черновики старше двух недель не отправляем: неделя уже закрыта, а текст устарел */
export const DRAFT_MAX_AGE_MS = 14 * 24 * 3_600_000;

/** Хранилище подменяется в тестах. Нет localStorage (приватный режим, запрет): работаем как раньше, без черновика */
export type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function storage(custom?: KeyValue): KeyValue | null {
  if (custom) return custom;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const empty = (): Store => ({ v: 1, entries: {}, headlines: {} });

function read(person: string, kv?: KeyValue): Store {
  const s = storage(kv);
  if (!s) return empty();
  try {
    const raw = s.getItem(PREFIX + person);
    const parsed = raw ? (JSON.parse(raw) as Store) : null;
    return parsed && parsed.v === 1 ? { v: 1, entries: parsed.entries ?? {}, headlines: parsed.headlines ?? {} } : empty();
  } catch {
    return empty();
  }
}

function write(person: string, store: Store, kv?: KeyValue): void {
  const s = storage(kv);
  if (!s) return;
  try {
    if (!Object.keys(store.entries).length && !Object.keys(store.headlines).length) s.removeItem(PREFIX + person);
    else s.setItem(PREFIX + person, JSON.stringify(store));
  } catch {
    // Место кончилось или хранилище запрещено: черновик не сохранится, но сервер по-прежнему сохраняет сам
  }
}

/** Новый ключ черновика: crypto.randomUUID, где он есть, иначе время и случайное число */
export function newDraftKey(): string {
  const c = typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function putEntryDraft(person: string, draft: EntryDraft, kv?: KeyValue): void {
  const store = read(person, kv);
  store.entries[draft.key] = draft;
  write(person, store, kv);
}

/**
 * Черновик дошёл до сервера. sentAt: когда ушла отправка. Если после неё человек ещё правил, черновик остаётся,
 * но запоминает id записи: следующая отправка правит её
 */
export function settleEntryDraft(person: string, key: string, entryId: string, sentAt: number, kv?: KeyValue): void {
  const store = read(person, kv);
  const d = store.entries[key];
  if (!d) return;
  if (d.savedAt <= sentAt) delete store.entries[key];
  else store.entries[key] = { ...d, entryId };
  write(person, store, kv);
}

export function dropEntryDraft(person: string, key: string, kv?: KeyValue): void {
  const store = read(person, kv);
  if (!store.entries[key]) return;
  delete store.entries[key];
  write(person, store, kv);
}

/** Черновики записей недели, которые ещё не дошли до сервера. Старые выбрасываются */
export function entryDrafts(person: string, week: string, now = Date.now(), kv?: KeyValue): EntryDraft[] {
  const store = read(person, kv);
  let changed = false;
  for (const [k, d] of Object.entries(store.entries)) {
    if (now - d.savedAt > DRAFT_MAX_AGE_MS) {
      delete store.entries[k];
      changed = true;
    }
  }
  if (changed) write(person, store, kv);
  return Object.values(store.entries)
    .filter((d) => d.input.week === week)
    .sort((a, b) => a.savedAt - b.savedAt);
}

export function putHeadlineDraft(person: string, week: string, value: string, now = Date.now(), kv?: KeyValue): void {
  const store = read(person, kv);
  store.headlines[week] = { week, value, savedAt: now };
  write(person, store, kv);
}

/** Главная фраза дошла. Если её правили после отправки, черновик остаётся */
export function settleHeadlineDraft(person: string, week: string, sentValue: string, kv?: KeyValue): void {
  const store = read(person, kv);
  const d = store.headlines[week];
  if (!d || d.value !== sentValue) return;
  delete store.headlines[week];
  write(person, store, kv);
}

export function headlineDraft(person: string, week: string, now = Date.now(), kv?: KeyValue): HeadlineDraft | null {
  const d = read(person, kv).headlines[week];
  if (!d || now - d.savedAt > DRAFT_MAX_AGE_MS) return null;
  return d;
}

/** Выход: черновики всех людей с этого устройства стираются */
export function clearOfflineDrafts(kv?: KeyValue): void {
  const s = storage(kv);
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    // Хранилище запрещено: стирать нечего
  }
}

/**
 * Ошибка вызова сервера из-за сети, а не правила: браузер без сети, запрос оборвался. Ответ сервера с текстом ошибки
 * сюда не попадает: он приходит как { ok: false }
 */
export function isNetworkError(error: unknown, online = typeof navigator === "undefined" ? true : navigator.onLine): boolean {
  if (!online) return true;
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /fetch|network|load failed|connection|offline/i.test(message);
}
