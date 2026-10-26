// Отчёт руководителю (этап 73). Решение Арама 23.10: «Заменим отчёт CEO на отчёт руководителю, так как каждый
// руководитель будет делать weekly для своего вышестоящего руководителя». Чистые функции без базы: их считают сервер,
// экраны и модульные тесты.

/**
 * Кандидаты в получатели отчёта команды по порядку (правило этапа 66): руководитель команды выше, затем
 * административный руководитель руководителя команды. Получатель: первый включённый из них. Сам руководитель команды
 * получателем не бывает
 */
export function recipientCandidates(
  node: { parentId: string | null; leaderId: string | null },
  nodes: readonly { id: string; active: boolean; leaderId: string | null }[],
  leaderManagerId: string | null,
): string[] {
  const parent = node.parentId ? nodes.find((n) => n.id === node.parentId) : undefined;
  const candidates: string[] = [];
  if (parent?.active && parent.leaderId && parent.leaderId !== node.leaderId) candidates.push(parent.leaderId);
  if (node.leaderId && leaderManagerId) candidates.push(leaderManagerId);
  return [...new Set(candidates)].filter((id) => id !== node.leaderId);
}

/** Вкладки раздела: текущая неделя (черновик и отправка), отправленные (архив), полученные (у руководителя) */
export type ReportTab = "current" | "sent" | "received";
export const REPORT_TABS: readonly ReportTab[] = ["current", "sent", "received"];
export const isReportTab = (v: unknown): v is ReportTab => typeof v === "string" && (REPORT_TABS as readonly string[]).includes(v);

/**
 * Какая вкладка открывается без вкладки в адресе: свою команду руководитель ведёт на «Текущей неделе», получатель
 * отчёта команды видит его в «Полученных». Ни того ни другого: «Полученные», если там что-то есть, иначе «Текущая неделя»
 */
export function defaultTab(opts: { canLead: boolean; recipient: boolean; hasReceived: boolean }): ReportTab {
  if (opts.recipient && !opts.canLead) return "received";
  if (opts.canLead) return "current";
  return opts.hasReceived ? "received" : "current";
}

/** Роли человека у отправленного отчёта */
export type ReportRoles = { author: boolean; recipient: boolean; owner: boolean };

/**
 * Кто у отправленного отчёта автор, получатель и владелец (этап 73). Автор: руководитель команды и тот, кто отправил.
 * Получатель: тот, кому отправили. Оба только при личном входе: по общему логину профиль выбирают сами. Владелец: в
 * режиме управления видит архив и комментарии всех команд
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
/** Комментарий к отчёту целиком или к строке пишет получатель */
export const canStartComment = (r: ReportRoles) => r.recipient;
/** Ответить на комментарий могут автор и получатель */
export const canReplyComment = (r: ReportRoles) => r.author || r.recipient;

export const REPORT_COMMENT_MAX = 1000;

/** Текст комментария: без длинного тире и стрелок, пробелы по краям убраны, не длиннее предела */
export function cleanCommentText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[—–‒―]/g, "-")
    .replace(/\s*[→⟶⇒➝➔⟹]\s*/g, " - ")
    .replace(/\r\n/g, "\n")
    .trim();
}

/**
 * Комментарий к строке: строка отправленной версии с тем же текстом в том же блоке. Сначала место из комментария, если
 * текст совпадает, потом первое совпадение по тексту. -1: такой строки нет (её убрали при повторной отправке)
 */
export function findLine(blocks: readonly { key: string; lines: readonly { text: string }[] }[], blockKey: string, text: string, index?: number | null): number {
  const block = blocks.find((b) => b.key === blockKey);
  if (!block) return -1;
  if (typeof index === "number" && block.lines[index]?.text === text) return index;
  return block.lines.findIndex((l) => l.text === text);
}

/** Предмет события «Мне» о комментарии: автору ведёт в «Отправленные», получателю в «Полученные» */
export const commentSubject = (side: "sent" | "received", teamId: string, week: string) => `report-comment:${side}:${teamId}:${week}`;
