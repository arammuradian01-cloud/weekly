// Прогресс цели по числам (этап 33): база, целевое значение и факт вписаны текстом, как в борде («29,25 млн», «15%»,
// «1 500 000», «+2 п.п.»). Если значения читаются числами в одних единицах, прогресс считается от базы к целевому.
// Текстовые цели («P&L к 15.12», «Скоринг на проде») прогресса в процентах не имеют: у них только итог и риск.
//
// Правила:
// - множитель («тыс», «млн», «млрд») написан только у части значений: остальные считаются в том же множителе
//   (база «120», целевое «150», факт «141 млн» читаются как миллионы);
// - целевое со знаком («+20%», «-5 п.п.», «+500») и любые п.п. это сдвиг от базы: «+2 п.п.» при базе 13% это 15%,
//   «+20%» при базе 120 это 144. Без базы сдвиг посчитать нельзя;
// - база «-», «нет», «н/д» значит базы нет: путь от нуля

export type GoalNumber = {
  /** Значение с множителем: «29,25 млн» = 29 250 000 */
  value: number;
  unit: "pct" | "plain";
  /** Множитель, если он написан: 1e3, 1e6, 1e9. Без слова 1 */
  scale: number;
  /** Написан знак «+» или «-» */
  signed: boolean;
  /** Процентные пункты: это всегда сдвиг */
  pp: boolean;
};

const SCALE: [RegExp, number][] = [
  [/^(млрд|bn)\.?$/i, 1e9],
  [/^(млн|mln|mio)\.?$/i, 1e6],
  [/^(тыс|k)\.?$/i, 1e3],
];
/** Слова, которые означают единицу, а не текст: рубли, штуки, полисы, лиды и подобное */
const NOISE = /^(руб|р|₽|rub|шт|штук|полис(ов|а)?|лид(ов|а)?|клик(ов|а)?|сделок|продаж|mau|чел|человек)\.?$/i;
const PLACEHOLDER = /^(-|–|—|нет|н\/д|n\/a|na|нд)$/i;

/**
 * Число из текста цели. «29,25 млн» = 29 250 000, «15%» = 15 (проценты), «+20%», «2 п.п.», «1 500 000 руб.».
 * Дата («15.12», «15.12.2026», «до 15.12»), диапазон, текст с другими словами или несколько чисел: null
 */
export function parseGoalNumber(input: string | null | undefined): GoalNumber | null {
  if (!input) return null;
  let t = String(input).replace(/ /g, " ").trim().toLowerCase();
  if (!t || t.length > 40) return null;
  // Дата или срок: «15.12.2026», «15.12», «до 15.12». Число с точкой и множителем («до 1.5 млн») датой не считается
  if (/\d{1,2}\.\d{1,2}\.\d{2,4}/.test(t)) return null;
  if (/^(до|к|с|по)?\s*\d{1,2}\.(0[1-9]|1[0-2])$/.test(t)) return null;
  t = t.replace(/^(до|не менее|не ниже|от|около|≈|~)\s+/, "");
  const m = /^([+-]?)(\d[\d ]{0,20}(?:[.,]\d{1,6})?)\s*(.*)$/.exec(t);
  if (!m) return null;
  const signed = m[1] !== "";
  const digits = m[2]!.replace(/ /g, "").replace(",", ".");
  let value = Number(digits);
  if (!Number.isFinite(value)) return null;
  if (m[1] === "-") value = -value;
  let rest = m[3]!.trim();
  let unit: GoalNumber["unit"] = "plain";
  let scale = 1;
  if (/^п\.?\s?п\.?$/.test(rest)) return { value, unit: "pct", scale, signed, pp: true };
  if (rest.startsWith("%")) {
    unit = "pct";
    rest = rest.slice(1).trim();
  }
  if (rest) {
    for (const w of rest.split(/\s+/)) {
      const s = SCALE.find(([re]) => re.test(w));
      if (s && unit === "plain" && scale === 1) scale = s[1];
      else if (!NOISE.test(w)) return null;
    }
  }
  return { value: value * scale, unit, scale, signed, pp: false };
}

/** Значения цели числами в одних множителях и целевое как абсолютное значение. null: не числа или не сопоставить */
export function goalNumbers(base: string | null | undefined, target: string | null | undefined, fact?: string | null): { base: GoalNumber | null; target: GoalNumber; fact: GoalNumber | null } | null {
  const baseText = base && !PLACEHOLDER.test(base.trim()) ? base : null;
  let b = baseText ? parseGoalNumber(baseText) : null;
  if (baseText && !b) return null;
  let t = parseGoalNumber(target);
  if (!t) return null;
  let f = fact ? parseGoalNumber(fact) : null;
  if (fact && !f) f = null;
  // Множитель написан только у части значений: остальные в нём же
  const scales = [...new Set([b, t, f].filter((x): x is GoalNumber => !!x && x.unit === "plain" && x.scale > 1).map((x) => x.scale))];
  if (scales.length === 1) {
    const k = scales[0]!;
    // Опорное значение с множителем: значение без множителя поднимается, только если так оно ближе к опорному
    // («141» при «150 млн» это 141 млн, а «14 625 000» при «29,25 млн» уже в рублях)
    const ref = Math.abs([t, b, f].find((x) => !!x && x.unit === "plain" && x.scale > 1)!.value);
    const closer = (v: number) => ref > 0 && v !== 0 && Math.abs(Math.log10((Math.abs(v) * k) / ref)) < Math.abs(Math.log10(Math.abs(v) / ref));
    const lift = (x: GoalNumber | null) => (x && x.unit === "plain" && x.scale === 1 && !(x === t && t.signed) && closer(x.value) ? { ...x, value: x.value * k, scale: k } : x);
    b = lift(b);
    t = lift(t)!;
    f = lift(f);
  }
  // Сдвиг от базы: «+2 п.п.», «+20%», «+500», «-5 п.п.»
  if (t.pp || t.signed) {
    if (!b) return null;
    if (t.pp) {
      if (b.unit !== "pct") return null;
      t = { ...t, value: b.value + t.value, unit: "pct", signed: false, pp: false };
    } else if (t.unit === "pct" && b.unit === "plain") {
      t = { ...t, value: b.value * (1 + t.value / 100), unit: "plain", scale: b.scale, signed: false };
    } else if (t.unit === "plain" && b.unit === "plain") {
      // Отрицательное без п.п. и процента это значение, а не сдвиг: «-5» при базе «-10»
      if (t.value < 0) t = { ...t, signed: false };
      else t = { ...t, value: b.value + t.value * (t.scale === 1 ? b.scale : 1), scale: b.scale, signed: false };
    } else {
      // «+20%» при базе в процентах: относительный рост или пункты, неясно
      return null;
    }
  }
  return { base: b, target: t, fact: f };
}

export type GoalProgress = {
  /** Доля пути от базы к целевому: 0,6 это 60%. Может быть больше 1 и меньше 0 */
  share: number;
  /** Цель на снижение: целевое меньше базы */
  down: boolean;
};

/** Целевое значение читается числом (с учётом базы для сдвига): факт ждут числом и следят за свежестью */
export function measurableTarget(base: string | null | undefined, target: string | null | undefined): boolean {
  return goalNumbers(base, target) !== null;
}

/**
 * Прогресс от базы к целевому по факту. Без базы путь считается от нуля. Единицы должны совпадать: проценты с
 * процентами. Нет факта или целевого, или целевое равно базе: null
 */
export function goalProgress(base: string | null | undefined, target: string | null | undefined, fact: string | null | undefined): GoalProgress | null {
  const n = goalNumbers(base, target, fact);
  if (!n || !n.fact) return null;
  const b = n.base ?? { value: 0, unit: n.target.unit };
  if (n.target.unit !== n.fact.unit || n.target.unit !== b.unit) return null;
  const span = n.target.value - b.value;
  if (span === 0) return null;
  return { share: (n.fact.value - b.value) / span, down: span < 0 };
}

/** Почему факт не подходит к целевому: не число, другие единицы, расхождение больше чем в 1000 раз. null: подходит */
export function factProblem(base: string | null | undefined, target: string | null | undefined, fact: string): string | null {
  const n = goalNumbers(base, target, fact);
  if (!n) return null;
  if (!n.fact) return `Целевое значение «${target}» число: впишите факт числом, например ${n.target.unit === "pct" ? "12,5%" : "141"}`;
  if (n.fact.unit !== n.target.unit) return n.target.unit === "pct" ? "Целевое значение в процентах: впишите факт тоже в процентах" : "Целевое значение не в процентах: впишите факт без знака процента";
  const a = Math.abs(n.fact.value);
  const c = Math.abs(n.target.value);
  if (a > 0 && c > 0 && (a / c > 1000 || c / a > 1000)) return "Факт отличается от целевого больше чем в 1000 раз: проверьте единицы (тыс, млн)";
  return null;
}

/** «60%» для прогресса, с одним знаком после запятой до 10% */
export function progressLabel(p: GoalProgress | null): string | null {
  if (!p) return null;
  let pct = p.share * 100;
  if (Math.abs(pct) < 0.05) pct = 0;
  const digits = Math.abs(pct) < 10 && pct !== 0 ? 1 : 0;
  return `${pct.toLocaleString("ru-RU", { maximumFractionDigits: digits }).replace(/ /g, " ")}%`;
}

/** Достигнута ли цель по числам с учётом округления подписи: 99,96% показывается как 100% и считается выполненной */
export const reached = (p: GoalProgress | null) => !!p && p.share >= 0.9995;

/** Факт старше двух недель: пора обновить */
export const FACT_STALE_DAYS = 14;
