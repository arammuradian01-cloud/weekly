// Текст ячеек .xlsx как на экране таблицы и проверка архива до распаковки (этап 31). Чистые функции без базы

/** Сколько займёт .xlsx после распаковки, по оглавлению архива. null: не архив или архив ZIP64 */
export function unpackedSize(data: Uint8Array): number | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const entries = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (entries === 0xffff || at === 0xffffffff) return null;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > data.length || view.getUint32(at, true) !== 0x02014b50) return null;
    const size = view.getUint32(at + 24, true);
    if (size === 0xffffffff) return null;
    total += size;
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return total;
}

const two = (n: number) => String(n).padStart(2, "0");

/** Дата ячейки как в таблице: 31.12.2026. Excel хранит даты без часового пояса, читаем по UTC */
export function formatDate(value: Date): string {
  return `${two(value.getUTCDate())}.${two(value.getUTCMonth() + 1)}.${value.getUTCFullYear()}`;
}

/** Число как на экране таблицы: проценты, разряды, знаки после запятой. 0.15 с форматом «0%» станет «15%» */
export function formatNumber(value: number, numFmt?: string | null): string {
  const fmt = (numFmt ?? "").replace(/"[^"]*"/g, "");
  const percent = fmt.includes("%");
  const decimals = fmt.match(/\.(0+)/)?.[1]?.length ?? (fmt && fmt !== "General" ? 0 : null);
  const v = percent ? value * 100 : value;
  if (decimals === null) return String(Number(v.toPrecision(12))).replace(".", ",") + (percent ? "%" : "");
  const [int, frac] = Math.abs(v).toFixed(decimals).split(".");
  const grouped = fmt.includes(",") ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : int!;
  return `${v < 0 ? "-" : ""}${grouped}${frac ? `,${frac}` : ""}${percent ? "%" : ""}`;
}
