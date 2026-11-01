// Отчёт руководителю (этап 73+81). Решения Арама 01.11: раздел «Отчёт руководителю» отдельным пунктом меню, внутри две
// вкладки, «Отправленные» и «Полученные»; у полученного отчёта руководитель оставляет комментарий. Экран получателя
// этапа 73а (PR #84) стал вкладкой «Полученные».
//
// Здесь чистые функции без базы: их считают сервер, экраны и модульные тесты.

/** Вкладки раздела: отправленные мной отчёты и полученные мной */
export type ReportTab = "sent" | "received";
export const REPORT_TABS: readonly ReportTab[] = ["sent", "received"];
export const isReportTab = (v: unknown): v is ReportTab => typeof v === "string" && (REPORT_TABS as readonly string[]).includes(v);

/**
 * Какая вкладка открывается без вкладки в адресе: руководитель команды собирает и отправляет отчёт сам, ему нужнее
 * «Отправленные». Тот, кто отчётов не отправляет, а только получает, открывает «Полученные»
 */
export function defaultTab(opts: { canLead: boolean; hasSent: boolean; hasReceived: boolean }): ReportTab {
  if (opts.canLead || opts.hasSent) return "sent";
  return opts.hasReceived ? "received" : "sent";
}

/** Роли человека у отправленного отчёта */
export type ReportRoles = { author: boolean; recipient: boolean; owner: boolean };

/**
 * Кто у отправленного отчёта автор, получатель и владелец. Автор: руководитель команды и тот, кто отправил.
 * Получатель: тот, кому отправили. И то и другое только при личном входе: по общему логину профиль выбирают сами,
 * чужую переписку он открывать не должен. Владелец: в режиме управления видит отчёты и комментарии всех команд
 */
export function reportRoles(
  viewer: { personId: string; via?: string | null; management: string | null },
  report: { leaderId: string | null; sentById: string | null; to: readonly { id: string }[] },
): ReportRoles {
  const personal = viewer.via !== "TEAM";
  return {
    author: personal && (report.leaderId === viewer.personId || report.sentById === viewer.personId),
    recipient: personal && report.to.some((t) => t.id === viewer.personId),
    owner: viewer.management === "OWNER",
  };
}

/** Комментарии видят только автор, получатель и владельцы; участники команды нет */
export const seesComments = (r: ReportRoles) => r.author || r.recipient || r.owner;
/** Комментарий к отчёту целиком или к строке пишет получатель: это его замечание автору */
export const canStartComment = (r: ReportRoles) => r.recipient;
/** Ответить в ветке могут автор отчёта и получатель */
export const canReplyComment = (r: ReportRoles) => r.author || r.recipient;

export const REPORT_COMMENT_MAX = 1000;

/** Текст комментария: без длинного тире и стрелок, пробелы по краям убраны */
export function cleanCommentText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[—–‒―]/g, "-")
    .replace(/\s*[→⟶⇒➝➔⟹]\s*/g, " - ")
    .replace(/\r\n/g, "\n")
    .trim();
}

/**
 * Строка отправленной версии, к которой написан комментарий: строка с тем же текстом в том же блоке. Сначала место из
 * комментария, если текст на нём совпадает, потом первое совпадение по тексту. -1: такой строки больше нет (её убрали
 * при повторной отправке), комментарий показывается цитатой
 */
export function findLine(blocks: readonly { key: string; lines: readonly { text: string }[] }[], blockKey: string, text: string, index?: number | null): number {
  const block = blocks.find((b) => b.key === blockKey);
  if (!block) return -1;
  if (typeof index === "number" && index >= 0 && block.lines[index]?.text === text) return index;
  return block.lines.findIndex((l) => l.text === text);
}

/** Предмет события «Мне» о комментарии: автору ведёт в «Отправленные», получателю в «Полученные» */
export const commentSubject = (side: ReportTab, teamId: string, week: string) => `report-comment:${side}:${teamId}:${week}`;

/** Разбор предмета события «Мне»: по нему строится ссылка в очереди «Ждёт вас» */
export function parseCommentSubject(subject: string): { side: ReportTab; teamId: string; week: string } | null {
  const parts = subject.split(":");
  if (parts.length !== 4 || parts[0] !== "report-comment" || !isReportTab(parts[1])) return null;
  return { side: parts[1], teamId: parts[2]!, week: parts[3]! };
}

/** Адрес вкладки раздела: неделя и команда сохраняются, чтобы ссылка открывала тот же отчёт */
export function reportHref(tab: ReportTab, opts: { week?: string | null; team?: string | null } = {}): string {
  const query = new URLSearchParams({ tab });
  if (opts.week) query.set("week", opts.week);
  if (opts.team) query.set("team", opts.team);
  return `/leader-report?${query.toString()}`;
}
