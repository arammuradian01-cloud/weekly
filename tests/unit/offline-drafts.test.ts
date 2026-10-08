import { describe, expect, it } from "vitest";
import {
  DRAFT_MAX_AGE_MS,
  clearOfflineDrafts,
  dropEntryDraft,
  entryDrafts,
  headlineDraft,
  isNetworkError,
  newDraftKey,
  putEntryDraft,
  putHeadlineDraft,
  settleEntryDraft,
  settleHeadlineDraft,
  type EntryDraft,
  type KeyValue,
} from "@/lib/offline/drafts";

/** localStorage в памяти: тесты идут без браузера */
function memory(): KeyValue & { dump: () => Record<string, string> } {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
    dump: () => Object.fromEntries(data),
  };
}

const input = (what: string, week = "2026-W41") => ({ week, direction: "kasko", block: "key-changes", type: "event", what, links: [] });
const draft = (key: string, what: string, savedAt: number, over: Partial<EntryDraft> = {}): EntryDraft => ({ key, entryId: null, clientKey: key, input: input(what), savedAt, ...over });

describe("черновик записи weekly на устройстве", () => {
  it("правка ложится в черновик, дошедший до сервера черновик убирается", () => {
    const kv = memory();
    putEntryDraft("reva", draft("k1", "Запустили пилот", 1000), kv);
    expect(entryDrafts("reva", "2026-W41", 2000, kv).map((d) => d.input.what)).toEqual(["Запустили пилот"]);
    settleEntryDraft("reva", "k1", "entry-1", 1500, kv);
    expect(entryDrafts("reva", "2026-W41", 2000, kv)).toEqual([]);
    expect(kv.length).toBe(0);
  });

  it("правили после отправки: черновик остаётся и запоминает id записи, следующая отправка правит её", () => {
    const kv = memory();
    putEntryDraft("reva", draft("k1", "Первый текст", 1000), kv);
    // Отправка ушла в 900, а текст поменяли в 1000: сервер получил старый текст
    settleEntryDraft("reva", "k1", "entry-1", 900, kv);
    expect(entryDrafts("reva", "2026-W41", 2000, kv)).toEqual([draft("k1", "Первый текст", 1000, { entryId: "entry-1" })]);
  });

  it("черновики разделены по людям и неделям, старые выбрасываются", () => {
    const kv = memory();
    putEntryDraft("reva", draft("a", "Неделя 41", 1000), kv);
    putEntryDraft("reva", { ...draft("b", "Неделя 40", 1000), input: input("Неделя 40", "2026-W40") }, kv);
    putEntryDraft("loginova", draft("c", "Чужой", 1000), kv);
    expect(entryDrafts("reva", "2026-W41", 2000, kv).map((d) => d.key)).toEqual(["a"]);
    expect(entryDrafts("loginova", "2026-W41", 2000, kv).map((d) => d.key)).toEqual(["c"]);
    expect(entryDrafts("reva", "2026-W41", 1000 + DRAFT_MAX_AGE_MS + 1, kv)).toEqual([]);
    expect(entryDrafts("reva", "2026-W40", 2000, kv)).toEqual([]);
    dropEntryDraft("loginova", "c", kv);
    expect(entryDrafts("loginova", "2026-W41", 2000, kv)).toEqual([]);
  });

  it("главная фраза: убирается, только если на сервер ушёл именно этот текст", () => {
    const kv = memory();
    putHeadlineDraft("reva", "2026-W41", "Главное: пилот", 1000, kv);
    settleHeadlineDraft("reva", "2026-W41", "Главное", kv);
    expect(headlineDraft("reva", "2026-W41", 2000, kv)?.value).toBe("Главное: пилот");
    settleHeadlineDraft("reva", "2026-W41", "Главное: пилот", kv);
    expect(headlineDraft("reva", "2026-W41", 2000, kv)).toBeNull();
  });

  it("выход стирает черновики всех людей и не трогает чужие ключи хранилища", () => {
    const kv = memory();
    kv.setItem("theme", "dark");
    putEntryDraft("reva", draft("a", "Текст", 1000), kv);
    putHeadlineDraft("loginova", "2026-W41", "Главное", 1000, kv);
    clearOfflineDrafts(kv);
    expect(kv.dump()).toEqual({ theme: "dark" });
  });

  it("испорченное хранилище не ломает экран", () => {
    const kv = memory();
    kv.setItem("weekly-offline:v1:reva", "{не json");
    expect(entryDrafts("reva", "2026-W41", 2000, kv)).toEqual([]);
    putEntryDraft("reva", draft("a", "Текст", 1000), kv);
    expect(entryDrafts("reva", "2026-W41", 2000, kv)).toHaveLength(1);
  });

  it("ключи черновиков уникальны и подходят серверу", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newDraftKey()));
    expect(keys.size).toBe(50);
    for (const k of keys) expect(k).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe("ошибка сети или ответ сервера", () => {
  it("нет сети, оборванный запрос: сеть; остальное нет", () => {
    expect(isNetworkError(new Error("что угодно"), false)).toBe(true);
    expect(isNetworkError(new TypeError("Failed to fetch"), true)).toBe(true);
    expect(isNetworkError(new Error("NetworkError when attempting to fetch resource."), true)).toBe(true);
    expect(isNetworkError(new Error("Load failed"), true)).toBe(true);
    expect(isNetworkError(new Error("Cannot read properties of undefined"), true)).toBe(false);
  });
});
