// Настройки дайджеста новостей человека (этап 60) без базы: их читает и профиль в браузере.
// Частота: по будням утром, еженедельно в понедельник или не присылать. Продукты: явный список кодов направлений
// или null, что значит «продукты моего направления» (по умолчанию).
//
// По умолчанию (решение Арама 22.10, приложение для всей компании): дайджест не приходит никому, пока человек сам
// не включит его в профиле. Продукты по умолчанию его направления. Писем без согласия ресурс не шлёт.

export type NewsFrequency = "daily" | "weekly" | "off";
export const NEWS_FREQUENCIES: NewsFrequency[] = ["daily", "weekly", "off"];
export const NEWS_FREQUENCY_LABELS: Record<NewsFrequency, string> = {
  daily: "По будням утром",
  weekly: "Раз в неделю, в понедельник",
  off: "Не присылать",
};

export type NewsPrefs = { frequency: NewsFrequency; directions: string[] | null };

const isFrequency = (v: unknown): v is NewsFrequency => typeof v === "string" && (NEWS_FREQUENCIES as string[]).includes(v);

/** Частота, если человек её не выбирал: не присылать */
export const DEFAULT_FREQUENCY: NewsFrequency = "off";

/** Настройки из базы */
export function newsPrefsOf(value: unknown): NewsPrefs {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const directions = Array.isArray(raw.directions) ? [...new Set(raw.directions.filter((d): d is string => typeof d === "string" && d.length > 0 && d.length <= 40))] : null;
  return { frequency: isFrequency(raw.frequency) ? raw.frequency : DEFAULT_FREQUENCY, directions };
}

/**
 * Продукты человека для дайджеста и блока на главной: его выбор, иначе направление из карточки.
 * «Департамент» и «Страхование в целом» раскрываются во все продукты страхования: у руководителя департамента
 * новости всех направлений. Без выбора и без направления продуктов нет
 */
export function directionsFor(prefs: NewsPrefs, own: string | null, all: string[]): string[] {
  const known = new Set(all);
  if (prefs.directions) return prefs.directions.filter((d) => known.has(d));
  if (!own) return [];
  if (own === "department" || own === "insurance") return all.filter((d) => d !== "department");
  return known.has(own) ? [own] : [];
}
