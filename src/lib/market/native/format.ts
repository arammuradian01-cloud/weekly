// Числа рынка по-русски (этап 79): те же правила, что у дашборда из пакета (d3.formatLocale с запятой и неразрывным
// пробелом между тысячами), чтобы новая версия показывала ровно те же цифры. Минус: знак «−» (U+2212), как у d3.
// Чистые функции без браузера и базы: ими пользуются и сервер (тексты «Главное», подписи), и экран (оси, подсказки).

const MINUS = "−";
const NBSP = " ";

/** Сокращённые месяцы: «янв», «фев» */
export const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"] as const;
/** Полные месяцы в именительном падеже: «январь» */
export const MONF = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"] as const;

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Число с фиксированным числом знаков после запятой и группами тысяч (grouped: false без групп, как у процентов
    в дашборде). null, NaN и бесконечность: «-» */
export function fixed(value: number | null | undefined, digits: number, grouped = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const negative = value < 0 || Object.is(value, -0);
  const text = Math.abs(value).toFixed(digits);
  const [int, frac] = text.split(".");
  const body = (grouped ? group(int!) : int!) + (frac ? `,${frac}` : "");
  // Отрицательное, округлившееся до нуля, показывается без знака: «0,0», а не «−0,0» (как у d3)
  const zero = /^[0, ]+$/.test(body);
  return negative && !zero ? MINUS + body : body;
}

export const n0 = (v: number | null | undefined) => fixed(v, 0);
export const n1 = (v: number | null | undefined) => fixed(v, 1);
export const n2 = (v: number | null | undefined) => fixed(v, 2);
/** Доля в процентах: 0,1234 → «12,3%» */
export const p1 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : `${fixed(v * 100, 1, false)}%`);
export const p2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : `${fixed(v * 100, 2, false)}%`);

const sign = (v: number) => (v > 0 ? "+" : v < 0 ? MINUS : "");

/** Рост со знаком: 0,051 → «+5,1%», −0,02 → «−2,0%» */
export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return sign(v) + p1(Math.abs(v));
}

/** Изменение доли в процентных пунктах со знаком: 0,012 → «+1,2 п.п.»; small: два знака после запятой */
export function pp(v: number | null | undefined, small = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return sign(v) + (small ? p2(Math.abs(v)) : p1(Math.abs(v))).replace("%", " п.п.");
}

/** Число со знаком: «+1,5», «−0,3» */
export function signed(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return sign(v) + fixed(Math.abs(v), digits);
}

/** Месяц «2026-09» → «сен 2026» */
export const monthShort = (m: string) => `${MON[Number(m.slice(5, 7)) - 1] ?? "?"} ${m.slice(0, 4)}`;
/** Месяц «2026-09» → «сен 26»: подписи оси */
export const monthAxis = (m: string) => `${MON[Number(m.slice(5, 7)) - 1] ?? "?"} ${m.slice(2, 4)}`;
/** Месяц «2026-09» → «сентябрь 2026» */
export const monthLong = (m: string) => `${MONF[Number(m.slice(5, 7)) - 1] ?? "?"} ${m.slice(0, 4)}`;
/** Дата «2026-09-14» → «14 сен» */
export function dayShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/** Тот же месяц год назад: «2026-09» → «2025-09» */
export const yearAgo = (m: string) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
/** Предыдущий месяц: «2026-01» → «2025-12» */
export function monthBefore(m: string): string {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}

export type FormatKey = "n0" | "n1" | "n2" | "p1" | "p2" | "pct";
export const FORMATS: Record<FormatKey, (v: number | null | undefined) => string> = { n0, n1, n2, p1, p2, pct };
