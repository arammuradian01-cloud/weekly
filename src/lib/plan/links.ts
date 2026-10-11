// Адреса страницы прогноза из событий и писем (этап 46): предмет события plan:<месяц> ведёт на прогноз месяца,
// plan:<месяц>:partners на вкладку «Партнёры», где команда канала проверяет свой прогноз

export function planHref(subject: string): string {
  const [, month, part] = subject.split(":");
  const m = encodeURIComponent(month ?? "");
  return part === "partners" ? `/forecast?tab=partners&month=${m}` : `/forecast?month=${m}`;
}
