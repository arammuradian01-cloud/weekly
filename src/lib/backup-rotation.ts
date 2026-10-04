// Правила хранения копий: 30 ежедневных и 12 ежемесячных (раздел 6 ТЗ).

export const BACKUP_PREFIX = "weekly-";
export const BACKUP_EXT = ".dump";

/** Имя файла по московскому времени: weekly-2026-10-04_0300.dump */
export function backupFileName(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${BACKUP_PREFIX}${get("year")}-${get("month")}-${get("day")}_${hour}${get("minute")}${BACKUP_EXT}`;
}

/** Месяц копии по имени файла: 2026-10 */
export function monthOf(fileName: string): string | null {
  const m = fileName.match(/^weekly-(\d{4}-\d{2})-\d{2}_\d{4}\.dump$/);
  return m ? m[1]! : null;
}

/** Какие файлы удалить, чтобы осталось keep самых свежих. Имена сортируются как даты */
export function filesToDelete(fileNames: string[], keep: number): string[] {
  const ours = fileNames.filter((f) => monthOf(f) !== null).sort();
  return ours.length > keep ? ours.slice(0, ours.length - keep) : [];
}

/** Нужна ли ежемесячная копия: в этом месяце её ещё нет */
export function needsMonthly(monthlyFiles: string[], newFile: string): boolean {
  const month = monthOf(newFile);
  return month !== null && !monthlyFiles.some((f) => monthOf(f) === month);
}
