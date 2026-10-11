// Числа прогноза месяца на экране (этап 32): штуки с разрядами, доли в процентах, рубли, миллионы. Ввод драйвера в тех же
// единицах, что на экране: конверсию вводят в процентах, 10,5 это 10,5%

import { ru } from "@/lib/numbers/parse";
import type { PlanUnit } from "./spec";

/** Знаков после запятой у миллионов: крупные с одним, мелкие точнее */
const mlnDigits = (v: number) => (Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 1 ? 2 : 3);

export function formatPlan(value: number | null | undefined, unit: PlanUnit): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "нет";
  switch (unit) {
    case "count":
      return ru(Math.round(value), 0);
    case "pct": {
      // Знаков после запятой поровну в колонке: 10,0% под 10,4%
      const d = Math.abs(value) < 0.1 ? 2 : 1;
      return `${ru(value * 100, d, d)}%`;
    }
    case "rub":
      return `${ru(value, Math.abs(value) < 100 ? 1 : 0)} ₽`;
    case "mln": {
      const d = mlnDigits(value);
      return ru(value, d, d);
    }
  }
}

/** Единица для подписи колонки или поля */
export function unitLabel(unit: PlanUnit): string {
  return unit === "count" ? "шт." : unit === "pct" ? "%" : unit === "rub" ? "₽" : "млн ₽";
}

export type PlanDelta = { text: string; pct: string | null; sign: -1 | 0 | 1 };

/** Изменение к базе: для долей в процентных пунктах, для остального разница и проценты. null, если сравнивать не с чем */
export function formatPlanDelta(value: number | null | undefined, base: number | null | undefined, unit: PlanUnit): PlanDelta | null {
  if (value == null || base == null || !Number.isFinite(value) || !Number.isFinite(base)) return null;
  const diff = value - base;
  const tiny = Math.abs(diff) <= 1e-9 * Math.max(1, Math.abs(base));
  const sign: PlanDelta["sign"] = tiny ? 0 : diff > 0 ? 1 : -1;
  const plus = sign > 0 ? "+" : "";
  if (tiny) return { text: "0", pct: null, sign: 0 };
  if (unit === "pct") return { text: `${plus}${ru(diff * 100, 2)} п.п.`, pct: null, sign };
  // Точность разницы как у самих значений: у итога в сотни миллионов один знак после запятой
  const abs = unit === "count" ? ru(Math.round(diff), 0) : unit === "rub" ? `${ru(diff, Math.abs(base) < 100 ? 1 : 0)} ₽` : ru(diff, mlnDigits(Math.max(Math.abs(value), Math.abs(base))));
  const pct = base === 0 ? null : `${plus}${ru((diff / Math.abs(base)) * 100, 1)}%`;
  return { text: `${plus}${abs}`, pct, sign };
}

/** Значение для поля ввода: доли в процентах, без разрядов */
export function inputValue(value: number | null | undefined, unit: PlanUnit): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const shown = unit === "pct" ? value * 100 : value;
  const digits = unit === "count" ? 0 : unit === "rub" ? 2 : unit === "pct" ? 3 : 4;
  return String(Number(shown.toFixed(digits))).replace(".", ",");
}

/** Ввод человека в значение показателя: пробелы и запятая, проценты для долей. null: пусто, NaN: не число */
export function parsePlanInput(text: string, unit: PlanUnit): number | null {
  const t = String(text ?? "").replace(/[\s ₽%]/g, "").replace(",", ".");
  if (!t) return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return Number.NaN;
  const n = Number(t);
  return unit === "pct" ? n / 100 : n;
}

/**
 * Границы значения драйвера: защита от опечаток на порядок и от бессмыслицы. Если в LBE ноль (сезонный продукт),
 * сравнивать не с чем, и границы широкие
 */
export function driverBounds(unit: PlanUnit, lbe: number | null): { min: number; max: number } {
  const base = Math.abs(lbe ?? 0);
  switch (unit) {
    case "count":
      return { min: 0, max: base > 0 ? Math.max(base * 10, 1_000) : 10_000_000 };
    case "pct":
      return { min: 0, max: Math.max(base * 5, 1) };
    case "rub":
      return { min: 0, max: base > 0 ? Math.max(base * 10, 1_000) : 1_000_000 };
    case "mln": {
      const span = base > 0 ? Math.max(base * 10, 10) : 1_000;
      return { min: -span, max: span };
    }
  }
}

/**
 * Первая буква строчной для подписи внутри фразы: «Конверсия сайта» в «конверсия сайта». Аббревиатуры и имена не
 * трогаются: «CPA и отказной» остаётся как есть, «Полисы через Сравни» не теряет прописную в «Сравни»
 */
export function lcFirst(s: string): string {
  if (s.length < 2) return s.toLowerCase();
  const second = s.charAt(1);
  return second !== second.toUpperCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
