// Правки отчёта по блокам в редакторе (этап 66): поднять и опустить блок, скрыть, поправить, добавить и убрать строку,
// собрать блок заново из свежей автосборки. Чистые функции: каждая возвращает новый список блоков, исходный не меняется.
// Правка строк помечает блок поправленным руками (edited): живые цифры такого блока сами больше не пересобираются.

import { BLOCK_LIMITS, legacyToBlocks, tidy, type BlockLine, type LegacySections, type ProductRef, type ReportBlock } from "./types";

export function moveBlock(blocks: readonly ReportBlock[], key: string, dir: -1 | 1): ReportBlock[] {
  const i = blocks.findIndex((b) => b.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= blocks.length) return [...blocks];
  const out = [...blocks];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export function setHidden(blocks: readonly ReportBlock[], key: string, hidden: boolean): ReportBlock[] {
  return blocks.map((b) => (b.key === key ? { ...b, hidden } : b));
}

/**
 * Правка строки. Текст чистится как при сохранении, но без обрезки пробелов по краям: человек ещё печатает. Длинное тире
 * и стрелки сразу становятся дефисом
 */
export function patchLine(blocks: readonly ReportBlock[], key: string, index: number, patch: Partial<BlockLine>): ReportBlock[] {
  return blocks.map((b) => {
    if (b.key !== key || !b.lines[index]) return b;
    const next = { ...b.lines[index]!, ...patch };
    if (patch.text !== undefined) next.text = patch.text.replace(/[—–‒―]/g, "-").replace(/[→⟶⇒➝➔⟹]/g, "-").replace(/·/g, ",").slice(0, BLOCK_LIMITS.text);
    if (patch.href === null) next.source = null;
    return { ...b, edited: true, lines: b.lines.map((l, i) => (i === index ? next : l)) };
  });
}

export function addLine(blocks: readonly ReportBlock[], key: string, product: string | null): ReportBlock[] {
  return blocks.map((b) => (b.key === key && b.lines.length < BLOCK_LIMITS.lines ? { ...b, hidden: false, edited: true, lines: [...b.lines, { product, text: "", href: null, source: null }] } : b));
}

export function removeLine(blocks: readonly ReportBlock[], key: string, index: number): ReportBlock[] {
  return blocks.map((b) => (b.key === key ? { ...b, edited: true, lines: b.lines.filter((_, i) => i !== index) } : b));
}

/** Собрать один блок заново: строки и пояснение из свежей автосборки, место и название блока остаются. Цифры снова живые */
export function rebuildBlock(blocks: readonly ReportBlock[], fresh: readonly ReportBlock[], key: string): ReportBlock[] {
  const f = fresh.find((b) => b.key === key);
  if (!f) return [...blocks];
  return blocks.map((b) => (b.key === key ? { ...b, lines: f.lines.map((l) => ({ ...l })), note: f.note, hidden: f.hidden, basis: f.basis ?? null, edited: false, stale: false } : b));
}

/** Перед сохранением: пустые строки (человек нажал «Добавить строку» и ничего не написал) отбрасываются */
export function withoutEmptyLines(blocks: readonly ReportBlock[]): ReportBlock[] {
  return blocks.map((b) => ({ ...b, title: tidy(b.title, BLOCK_LIMITS.title) || b.title, lines: b.lines.filter((l) => l.text.trim()) }));
}

/** Продукт новой строки: в «Партнёрском канале» партнёрка, в остальных блоках департамент, иначе первый продукт */
export function defaultProduct(key: string, products: readonly { code: string }[]): string | null {
  const has = (c: string) => products.some((p) => p.code === c);
  if (key === "partners" && has("partners")) return "partners";
  if (key === "products") return products.find((p) => p.code !== "partners" && p.code !== "department")?.code ?? products[0]?.code ?? null;
  return has("department") ? "department" : (products[0]?.code ?? null);
}

/** Блоки, которые собираются из цифр и новостей заново, даже когда отчёт сохранён в прежнем виде */
const LIVE_KEYS = new Set(["wow", "month", "competitors"]);

/**
 * Отчёт, сохранённый в прежнем виде (главное, риски, что дальше), в редакторе по блокам: текст раскладывается по
 * продуктам, рискам и плану, цифры недели и месяца и конкуренты берутся из свежей автосборки
 */
export function fromLegacy(sections: LegacySections, auto: readonly ReportBlock[], products: readonly ProductRef[]): ReportBlock[] {
  const legacy = legacyToBlocks(sections, products);
  return legacy.map((b) => (LIVE_KEYS.has(b.key) ? (auto.find((a) => a.key === b.key) ?? b) : b));
}
