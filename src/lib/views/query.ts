// Строка фильтров вида без базы (этап 25): нужна и серверу, и экрану

/** Параметры адреса, которые вид запоминает. Остальное (например, открытая задача) не сохраняется */
const KEPT_KEYS = new Set(["q", "f", "owner", "group", "closed", "archive", "sort", "dir", "direction"]);

/** Строка адреса в каноническом виде: только известные ключи, по алфавиту, без пустых значений */
export function normalizeQuery(raw: string): string {
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  const pairs: [string, string][] = [];
  for (const [k, v] of params) if (KEPT_KEYS.has(k) && v.trim()) pairs.push([k, v.trim()]);
  pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return new URLSearchParams(pairs).toString();
}
