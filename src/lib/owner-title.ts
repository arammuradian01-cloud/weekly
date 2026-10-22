// Подпись роли владельца (этап 69). Главный владелец задаёт её себе и совладельцам в «Настройках», например
// «ex-Владелец» себе и «Владелец» совладельцу. Подпись только меняет текст роли на экранах: права по-прежнему решают
// роль и главный владелец. Модуль без базы: его проверяют модульные тесты и зовут сервис настроек и экраны.

export const OWNER_TITLE_MIN = 2;
export const OWNER_TITLE_MAX = 30;

/** Настройка с подписями: { слаг владельца: подпись }. Пустая подпись в ней не хранится */
export const OWNER_TITLES_KEY = "owners.titles";

export const OWNER_TITLE_TEXTS = {
  length: `Подпись роли: от ${OWNER_TITLE_MIN} до ${OWNER_TITLE_MAX} знаков. Пустое поле вернёт подпись по умолчанию`,
  chars: "Подпись роли: только буквы, цифры, пробел, дефис, точка, запятая и скобки",
  letter: "В подписи роли нужна хотя бы одна буква",
} as const;

// Буквы любого алфавита, цифры, пробел и простые знаки. Стрелки, точка посередине, кавычки и значки не проходят
const ALLOWED = /^[\p{L}\p{N} .,()-]+$/u;

export type OwnerTitleCheck = { ok: true; title: string | null } | { ok: false; error: string };

/**
 * Подпись из поля ввода: буквы собраны в составную форму (NFC: «й» и «ё», скопированные из PDF двумя знаками, становятся
 * одним), пробелы по краям обрезаны, подряд идущие склеены, длинное и среднее тире стали дефисом, как в остальных полях
 * ресурса. Пустая строка: подписи нет, действует правило по умолчанию
 */
export function checkOwnerTitle(input: string | null | undefined): OwnerTitleCheck {
  const title = String(input ?? "")
    .normalize("NFC")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return { ok: true, title: null };
  if (title.length < OWNER_TITLE_MIN || title.length > OWNER_TITLE_MAX) return { ok: false, error: OWNER_TITLE_TEXTS.length };
  if (!ALLOWED.test(title)) return { ok: false, error: OWNER_TITLE_TEXTS.chars };
  if (!/\p{L}/u.test(title)) return { ok: false, error: OWNER_TITLE_TEXTS.letter };
  return { ok: true, title };
}

/** Подписи из настройки: только строки, которые проходят проверку. Сломанное значение настройки не роняет экраны */
export function ownerTitlesFrom(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [slug, raw] of Object.entries(value as Record<string, unknown>)) {
    // Служебное имя объекта не слаг: записью в него подпись не сохранить, а прочитать можно чужое
    if (typeof raw !== "string" || slug === "__proto__") continue;
    const check = checkOwnerTitle(raw);
    if (check.ok && check.title) out[slug] = check.title;
  }
  return out;
}

/**
 * Подпись человека из списка подписей или null. Только собственные ключи: слаг вроде «constructor» не должен находить
 * служебное свойство объекта
 */
export function titleOf(titles: Record<string, string>, slug: string): string | null {
  if (!Object.hasOwn(titles, slug)) return null;
  const title = titles[slug];
  return typeof title === "string" ? title : null;
}
