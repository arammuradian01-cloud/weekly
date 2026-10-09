// Текст ячеек .xlsx как на экране таблицы (этап 31). Чистые функции без базы

const two = (n: number) => String(n).padStart(2, "0");

/** Дата ячейки как в таблице: 31.12.2026. Excel хранит даты без часового пояса, читаем по UTC */
export function formatDate(value: Date): string {
  return `${two(value.getUTCDate())}.${two(value.getUTCMonth() + 1)}.${value.getUTCFullYear()}`;
}

/** Подписи формата: «"млн"», «[$₽-419]», «\\р» как текст; пропуски «_)» и цвета «[Red]» убираются */
function literal(part: string): string {
  return part
    .replace(/\[\$([^\]-]*)(-[^\]]*)?\]/g, "$1")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/"([^"]*)"/g, "$1")
    .replace(/\\(.)/g, "$1")
    .replace(/[_*]./g, "")
    .replace(/%/g, "");
}

/** Число как на экране таблицы: проценты, разряды, знаки после запятой, подписи вроде «млн» и «₽».
 *  0.15 с форматом «0%» станет «15%», 29.25 с форматом «0.00" млн"» станет «29,25 млн» */
export function formatNumber(value: number, numFmt?: string | null): string {
  const section = (numFmt ?? "").split(";")[0] ?? "";
  const plain = () => String(Number(value.toPrecision(12))).replace(".", ",");
  if (!section || section === "General" || section === "@") return plain();
  const token = section.replace(/"[^"]*"|\[[^\]]*\]|\\./g, (m) => " ".repeat(m.length)).match(/[#0?][#0?,.]*/);
  if (!token) return plain();
  const number = token[0];
  const before = literal(section.slice(0, token.index));
  const after = section.slice(token.index! + number.length);
  const percent = section.replace(/"[^"]*"/g, "").includes("%");
  const decimals = number.match(/\.([0#?]+)/)?.[1]?.length ?? 0;
  const v = percent ? value * 100 : value;
  const [int, frac] = Math.abs(v).toFixed(decimals).split(".");
  const grouped = number.includes(",") ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : int!;
  return `${v < 0 ? "-" : ""}${before}${grouped}${frac ? `,${frac}` : ""}${percent ? "%" : ""}${literal(after)}`.trim();
}
