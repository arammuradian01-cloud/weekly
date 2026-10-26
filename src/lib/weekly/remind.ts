// «Напомнить не сдавшим» (этап 73, аудит удобства 23.10): руководитель из ленты weekly своей команды одним нажатием
// напоминает тем, кто ещё не сдал weekly за неделю. Событие в «Мне»; уведомление в браузере уходит само из минутного
// прохода (src/lib/push/service.ts), если человек их включил, письмо по его настройкам писем.

import { prisma } from "@/lib/db";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { notify } from "@/lib/inbox/notify";
import { TOP_TEAM, loadScope, loadTeamNodes } from "@/lib/org/scope";
import { expectedOf, leadersOf } from "@/lib/org/rhythm";
import { audit, currentReportingKey, getWeekView } from "./service";
import { isWeekKey, weekNumberOf } from "./weeks";
import { moscowMoment } from "./rules";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

/** Повторное напоминание тому же человеку за ту же неделю не чаще раза в шесть часов */
export const REMIND_GAP_MS = 6 * 3_600_000;

export const remindSubject = (week: string) => `weekly-remind:${week}`;

/**
 * Напомнить не сдавшим weekly команды за неделю. Кто может: руководитель команды (и руководитель выше) при личном
 * входе, владелец и администраторы в режиме управления; без команды (все команды) только режим управления. Не сдавшие:
 * от кого weekly ждут, кого нет в отпуске, у кого черновик или weekly не начат
 */
export async function remindNotSubmitted(actor: Actor, teamId: string | null, key: string, now = new Date()): Promise<{ sent: number; skipped: number }> {
  if (actor.role === "OBSERVER") fail("Наблюдатель не напоминает");
  if (!isWeekKey(key)) fail("Неделя задаётся понедельником");
  if (!actor.management && actor.via === "TEAM") fail("Напомнить можно при личном входе: так видно, кто напоминает");
  const reporting = await currentReportingKey(now);
  if (key > reporting) fail("За будущую неделю weekly не ждут");
  const nodes = await loadTeamNodes(prisma);
  let audience: Parameters<typeof getWeekView>[2];
  let teamName = "";
  if (!teamId) {
    if (!actor.management) fail("Напомнить всем командам сразу может владелец или администратор в режиме управления");
    audience = undefined;
  } else {
    const node = nodes.find((n) => n.id === teamId && n.active);
    if (!node) return fail("Такой команды нет");
    teamName = node.name;
    if (!actor.management) {
      const scope = await loadScope(prisma, { id: actor.personId, role: actor.role });
      const leads = node.leaderId === actor.personId || scope.leads.includes(node.id);
      if (!leads) fail("Напоминает руководитель команды, руководитель выше или режим управления");
    }
    audience = { personIds: expectedOf(node, leadersOf(nodes)), shared: node.id === TOP_TEAM, teamIds: [node.id] };
  }
  const view = await getWeekView(key, now, audience);
  if (view.week.closed) fail(`Неделя ${view.week.number} закрыта: напоминать поздно, сдать можно задним числом`);
  const slugs = view.reports.filter((r) => !r.optional && !r.absent && (r.state === "draft" || r.state === "not-started")).map((r) => r.author);
  const people = slugs.length ? await prisma.person.findMany({ where: { slug: { in: slugs }, active: true }, select: { id: true, fullName: true } }) : [];
  const targets = people.filter((p) => p.id !== actor.personId);
  if (!targets.length) fail("Напоминать некому: все, от кого ждут weekly, уже сдали");
  const subject = remindSubject(key);
  const recent = await prisma.inboxEvent.findMany({
    where: { subject, recipientId: { in: targets.map((t) => t.id) }, createdAt: { gt: new Date(now.getTime() - REMIND_GAP_MS) } },
    select: { recipientId: true },
  });
  const fresh = targets.filter((t) => !recent.some((r) => r.recipientId === t.id));
  if (!fresh.length) return { sent: 0, skipped: targets.length };
  const deadline = view.week.deadline;
  await prisma.$transaction(async (tx) => {
    await notify(
      tx,
      {
        kind: "WEEKLY_REMIND",
        recipients: fresh.map((t) => t.id),
        actor,
        subject,
        text: `${actor.fullName} напоминает сдать weekly за неделю ${weekNumberOf(key)}${key === reporting ? `, срок ${moscowMoment(deadline)}` : ": неделя прошла, сдать можно задним числом"}`,
      },
      now,
    );
    await audit(tx, actor, "weekly.remind", "weekly-remind", `${key}${teamId ? `/${teamId}` : ""}`, `Напоминание сдать weekly за неделю ${weekNumberOf(key)}${teamName ? `, команда «${teamName}»` : ""}`, null, fresh.map((t) => t.fullName).join(", "));
  });
  return { sent: fresh.length, skipped: targets.length - fresh.length };
}
