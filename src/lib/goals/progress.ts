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
  // Любые пробелы (неразрывный, узкий) как обычный: так вставляют числа из таблиц
  let t = String(input).replace(/[\u00a0\u2007\u2009\u202f]/g, " ").trim().toLowerCase();
  if (!t || t.length > 40) return null;
  // Дата или срок: «15.12.2026», «15.12», «01.10», «до 15.12». День двумя цифрами: «1.10» и «0.05» это числа
  if (/\d{1,2}\.\d{1,2}\.\d{2,4}/.test(t)) return null;
  if (/^((до|к|с|по)\s+)?(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])$/.test(t)) return null;
  t = t.replace(/^(до|к|не менее|не ниже|от|около|≈|~)\s+/, "");
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

/**
 * Значение сдвигом от базы в абсолютное: «+2 п.п.» при 13% это 15%, «+20%» при 120 это 144, «+30» при 120 млн это
 * 150 млн, «-500 тыс» при 3 млн это 2,5 млн. Отрицательное при отрицательной базе это значение («-5» при «-10»).
 * Не сдвиг: как есть. Сдвиг без базы или «+20%» при базе в процентах (рост или пункты, неясно): null
 */
function resolve(x: GoalNumber, b: GoalNumber | null): GoalNumber | null {
  if (!x.pp && !x.signed) return x;
  if (!b) return null;
  if (x.pp) return b.unit === "pct" ? { ...x, value: b.value + x.value, signed: false, pp: false } : null;
  if (x.unit === "pct") return b.unit === "plain" ? { ...x, value: b.value * (1 + x.value / 100), unit: "plain", scale: b.scale, signed: false } : null;
  if (b.unit !== "plain") return null;
  if (x.value < 0 && b.value < 0) return { ...x, signed: false };
  return { ...x, value: b.value + x.value * (x.scale === 1 ? b.scale : 1), scale: b.scale, signed: false };
}

/**
 * Значения цели числами в одних множителях, целевое и факт абсолютными значениями. null: целевое не число.
 * lenientBase: база текстом («новый продукт») считается отсутствующей, иначе с такой базой прогресс не считается
 */
export function goalNumbers(
  base: string | null | undefined,
  target: string | null | undefined,
  fact?: string | null,
  opts: { lenientBase?: boolean } = {},
): { base: GoalNumber | null; target: GoalNumber; fact: GoalNumber | null } | null {
  const baseText = base && !PLACEHOLDER.test(base.trim()) ? base : null;
  let b = baseText ? parseGoalNumber(baseText) : null;
  if (baseText && !b && !opts.lenientBase) return null;
  if (b && (b.pp || (b.signed && b.unit === "pct"))) b = null;
  let t = parseGoalNumber(target);
  if (!t) return null;
  let f = fact ? parseGoalNumber(fact) : null;
  // Множитель написан только у части значений. Значение без множителя поднимается до него, только если как есть оно
  // меньше опорного в тысячу раз и больше, а с множителем попадает в тысячу раз от опорного: «141» при «150 млн» это
  // 141 млн, а «40» при «1,5 тыс» это 40, «14 625 000» при «29,25 млн» уже в рублях
  const scaled = [b, t, f].filter((x): x is GoalNumber => !!x && x.unit === "plain" && x.scale > 1);
  const scales = [...new Set(scaled.map((x) => x.scale))];
  if (scales.length === 1) {
    const k = scales[0]!;
    const ref = Math.abs(scaled[0]!.value);
    const lift = (x: GoalNumber | null) => {
      if (!x || x.unit !== "plain" || x.scale !== 1 || x.signed || x.value === 0 || ref === 0) return x;
      const v = Math.abs(x.value);
      return v * 1000 < ref && v * k * 1000 >= ref && v * k <= ref * 1000 ? { ...x, value: x.value * k, scale: k } : x;
    };
    b = lift(b);
    t = lift(t)!;
    f = lift(f);
  }
  const target2 = resolve(t, b);
  if (!target2) return null;
  // Факт сдвигом («+1 п.п.») тоже от базы; если сдвиг не посчитать, факта нет
  const fact2 = f ? resolve(f, b) : null;
  return { base: b, target: target2, fact: fact2 };
}

export type GoalProgress = {
  /** Доля пути от базы к целевому: 0,6 это 60%. Может быть больше 1 и меньше 0 */
  share: number;
  /** Цель на снижение: целевое меньше базы */
  down: boolean;
};

/** Целевое значение читается числом (с учётом базы для сдвига): факт ждут числом и следят за свежестью */
export function measurableTarget(base: string | null | undefined, target: string | null | undefined): boolean {
  return goalNumbers(base, target, null, { lenientBase: true }) !== null;
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
  const n = goalNumbers(base, target, fact, { lenientBase: true });
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

/** Достигнута ли цель по числам с учётом округления подписи: от 99,5% подпись «100%», и полоса тоже зелёная */
export const reached = (p: GoalProgress | null) => !!p && p.share >= 0.995;

/** Факт старше двух недель: пора обновить */
export const FACT_STALE_DAYS = 14;
