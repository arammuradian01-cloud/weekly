// Прогресс цели по числам (этап 33): база, целевое значение и факт вписаны текстом, как в борде («29,25 млн», «15%»,
// «1 500 000»). Если все нужные значения читаются числами в одних единицах, прогресс считается от базы к целевому.
// Текстовые цели («P&L к 15.12», «Скоринг на проде») прогресса в процентах не имеют: у них только итог и риск

export type GoalNumber = { value: number; unit: "pct" | "plain" };

const SCALE: [RegExp, number][] = [
  [/^(млрд|bn|b)\.?$/i, 1e9],
  [/^(млн|mln|m|mio)\.?$/i, 1e6],
  [/^(тыс|k|т)\.?$/i, 1e3],
];
/** Слова, которые означают единицу, а не текст: рубли, штуки, полисы, лиды и подобное */
const NOISE = /^(руб|р|₽|rub|шт|штук|полис(ов|а)?|лид(ов|а)?|клик(ов|а)?|сделок|продаж|mau|чел|человек)\.?$/i;

/**
 * Число из текста цели. «29,25 млн» = 29 250 000, «15%» = 15 (проценты), «+20%» = 20, «1 500 000 руб.» = 1 500 000.
 * Дата, диапазон, текст с другими словами или несколько чисел: null
 */
export function parseGoalNumber(input: string | null | undefined): GoalNumber | null {
  if (!input) return null;
  let t = String(input).replace(/ /g, " ").trim().toLowerCase();
  if (!t || t.length > 40) return null;
  // Дата: «15.12.2026» или срок «до 15.12», «к 15.12». Просто «15.12» читается числом
  if (/\d{1,2}\.\d{1,2}\.\d{2,4}/.test(t) || /^(до|к|с|по)\s+\d{1,2}\.\d{1,2}/.test(t)) return null;
  t = t.replace(/^(до|не менее|не ниже|от|около|≈|~)\s+/, "");
  const m = /^([+-]?\d[\d\s]*(?:[.,]\d+)?)\s*(.*)$/.exec(t);
  if (!m) return null;
  const digits = m[1]!.replace(/\s/g, "").replace(",", ".");
  let value = Number(digits);
  if (!Number.isFinite(value)) return null;
  let rest = m[2]!.trim();
  let unit: GoalNumber["unit"] = "plain";
  if (rest.startsWith("%")) {
    unit = "pct";
    rest = rest.slice(1).trim();
  } else if (/^п\.?\s?п\.?$/.test(rest)) {
    return { value, unit: "pct" };
  }
  if (rest) {
    const words = rest.split(/\s+/);
    for (const w of words) {
      const scale = SCALE.find(([re]) => re.test(w));
      if (scale && unit === "plain") value *= scale[1];
      else if (!NOISE.test(w)) return null;
    }
  }
  return { value, unit };
}

export type GoalProgress = {
  /** Доля пути от базы к целевому: 0,6 это 60%. Может быть больше 1 и меньше 0 */
  share: number;
  /** Цель на снижение: целевое меньше базы */
  down: boolean;
};

/**
 * Прогресс от базы к целевому по факту. Без базы путь считается от нуля. Единицы должны совпадать: проценты с
 * процентами. Нет факта или целевого, или целевое равно базе: null
 */
export function goalProgress(base: string | null | undefined, target: string | null | undefined, fact: string | null | undefined): GoalProgress | null {
  const t = parseGoalNumber(target);
  const f = parseGoalNumber(fact);
  if (!t || !f) return null;
  const b = base ? parseGoalNumber(base) : { value: 0, unit: t.unit };
  if (!b) return null;
  if (t.unit !== f.unit || t.unit !== b.unit) return null;
  const span = t.value - b.value;
  if (span === 0) return null;
  return { share: (f.value - b.value) / span, down: span < 0 };
}

/** «60%» для прогресса, с одним знаком после запятой до 10% */
export function progressLabel(p: GoalProgress | null): string | null {
  if (!p) return null;
  const pct = p.share * 100;
  const digits = Math.abs(pct) < 10 && pct !== 0 ? 1 : 0;
  return `${pct.toLocaleString("ru-RU", { maximumFractionDigits: digits }).replace(/ /g, " ")}%`;
}

/** Факт старше двух недель: пора обновить */
export const FACT_STALE_DAYS = 14;
