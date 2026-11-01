// Раскрытие групп на roadmap (этап 84). Карта сроков начинается с целей: строка цели видна, её задачи спрятаны,
// нажатие на цель их раскрывает. Какие группы раскрыты, живёт в адресе страницы (?open=), чтобы ссылкой можно было
// поделиться и чтобы кнопка «Назад» возвращала прежний вид.
//
// Значения ?open=: нет значения это вид по умолчанию для группировки («По целям» всё свёрнуто, «Цели и задачи» всё
// раскрыто), «all» всё раскрыто, «none» всё свёрнуто, иначе список ключей через запятую. Ключ это id цели или
// «nogoal» у группы «Задачи без цели».

export const OPEN_ALL = "all";
export const OPEN_NONE = "none";
/** Ключ группы «Задачи без цели» */
export const NO_GOAL_KEY = "nogoal";

/** Группировки, у которых есть раскрытие: «По целям» и «Цели и задачи» */
export type OpenGroup = "goals" | "both";

/** Всё раскрыто по умолчанию: «Цели и задачи» это то же, что «По целям», только сразу раскрытое */
const openByDefault = (group: OpenGroup) => group === "both";

/**
 * Раскрытые группы: значение из адреса, группировка и все ключи на экране по порядку. Ключи, которых на экране нет
 * (цель ушла из-за фильтра), в набор не попадают: адрес остаётся прежним, а лишних групп не появляется
 */
export function openKeys(value: string | null | undefined, group: OpenGroup, all: readonly string[]): Set<string> {
  const v = (value ?? "").trim();
  if (!v) return new Set(openByDefault(group) ? all : []);
  if (v === OPEN_ALL) return new Set(all);
  if (v === OPEN_NONE) return new Set();
  const picked = new Set(
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return new Set(all.filter((k) => picked.has(k)));
}

/**
 * Значение ?open= для набора раскрытых групп. null значит «убрать параметр»: это и есть вид по умолчанию для
 * группировки, адрес остаётся коротким
 */
export function serializeOpen(open: ReadonlySet<string>, group: OpenGroup, all: readonly string[]): string | null {
  const kept = all.filter((k) => open.has(k));
  const everything = all.length > 0 && kept.length === all.length;
  const nothing = kept.length === 0;
  if (openByDefault(group) ? everything || !all.length : nothing) return null;
  if (everything) return OPEN_ALL;
  if (nothing) return OPEN_NONE;
  return kept.join(",");
}

/** Новое значение ?open= после нажатия на группу. null: параметр убирается */
export function toggleOpen(value: string | null | undefined, group: OpenGroup, all: readonly string[], key: string): string | null {
  const open = new Set(openKeys(value, group, all));
  if (open.has(key)) open.delete(key);
  else open.add(key);
  return serializeOpen(open, group, all);
}
