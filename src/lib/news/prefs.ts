// Настройки дайджеста новостей человека (этап 60) без базы: их читает и профиль в браузере.
// Частота: ежедневно утром, еженедельно в понедельник или не присылать. Продукты: явный список кодов направлений
// или null, что значит «продукты моего направления» (по умолчанию).

export type NewsFrequency = "daily" | "weekly" | "off";
export const NEWS_FREQUENCIES: NewsFrequency[] = ["daily", "weekly", "off"];
export const NEWS_FREQUENCY_LABELS: Record<NewsFrequency, string> = {
  daily: "Каждое утро",
  weekly: "Раз в неделю, в понедельник",
  off: "Не присылать",
};

export type NewsPrefs = { frequency: NewsFrequency; directions: string[] | null };
export const DEFAULT_NEWS_PREFS: NewsPrefs = { frequency: "weekly", directions: null };

const isFrequency = (v: unknown): v is NewsFrequency => typeof v === "string" && (NEWS_FREQUENCIES as string[]).includes(v);

export function newsPrefsOf(value: unknown): NewsPrefs {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const directions = Array.isArray(raw.directions) ? [...new Set(raw.directions.filter((d): d is string => typeof d === "string" && d.length > 0 && d.length <= 40))] : null;
  return { frequency: isFrequency(raw.frequency) ? raw.frequency : DEFAULT_NEWS_PREFS.frequency, directions };
}

/**
 * Продукты человека для дайджеста и блока на главной: его выбор, иначе направление из карточки.
 * «Департамент» и «Страхование в целом» раскрываются во все продукты страхования: у руководителя департамента
 * новости всех направлений
 */
export function directionsFor(prefs: NewsPrefs, own: string | null, all: string[]): string[] {
  const known = new Set(all);
  if (prefs.directions) return prefs.directions.filter((d) => known.has(d));
  if (!own || !known.has(own) || own === "department" || own === "insurance") return all.filter((d) => d !== "department");
  return [own];
}
