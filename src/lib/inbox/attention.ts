// Одно число для счётчика в меню и для заголовка блока «Ждёт вас» на «Моей неделе» (правка по ревью этапа 76).
//
// Раньше меню считало только предметы событий, а блок ещё и просроченные задачи, задачи со сроком сегодня и завтра
// и просьбы без ответа: человек видел «Ждёт вас 4» на странице и пустое меню рядом, а экранный диктор читал в меню
// другое число. Теперь обе стороны считают по одним правилам из me-tasks.ts, по одним и тем же данным.

import { prisma } from "@/lib/db";
import { listTasks, type Actor } from "@/lib/tasks/service";
import { myRequests } from "@/lib/requests/service";
import { missedWeeks } from "@/lib/weekly/service";
import { listInbox } from "./service";
import { attentionTotal, eventCount, hotTasks, queueCounts, splitRequests } from "@/components/inbox/me-tasks";
import { moscowDate } from "@/lib/week";
import { fromCalendar } from "@/domain/dates";
import type { ScopeSubject } from "@/lib/org/scope";

/** Кто считает: хватает того же, что нужно правилам видимости задач и просьб */
export type AttentionActor = Pick<Actor, "personId" | "slug" | "fullName" | "role" | "management" | "via">;

/**
 * Сколько ждёт человека: просроченные задачи и просьбы, задачи и просьбы на сегодня и завтра, просьбы без ответа,
 * события (без тихих и без тех, что уже стоят строкой задачи или просьбы) и несданные weekly за прошлые недели
 */
export async function attentionCount(actor: AttentionActor, now = new Date(), viewer?: ScopeSubject): Promise<number> {
  const today = fromCalendar(moscowDate(now));
  const [tasks, requests, inbox, missed] = await Promise.all([
    listTasks({ reader: { personId: actor.personId, role: actor.role, limited: viewer?.limited } }),
    myRequests(actor as Actor, now),
    listInbox(actor.personId, now, viewer),
    missedWeeks(actor.personId, now),
  ]);
  const hot = hotTasks({ tasks, today }, { slug: actor.slug, role: actor.role });
  const req = splitRequests(requests.incoming, today);
  const events = eventCount(inbox.items, requests.incoming, hot);
  return attentionTotal(queueCounts(hot, req, events), missed.length);
}

/**
 * То же число по одному человеку, когда действующего лица под рукой нет (письма рассылкой). Вход считается личным:
 * письмо приходит человеку, а не на общий логин
 */
export async function attentionCountFor(personId: string, now = new Date(), viewer?: ScopeSubject): Promise<number> {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { slug: true, fullName: true, role: true } });
  if (!person) return 0;
  const shared = !!viewer?.shared;
  return attentionCount(
    {
      personId,
      slug: person.slug ?? "",
      fullName: person.fullName,
      role: person.role,
      management: shared && !viewer?.limited ? "ADMIN" : null,
      via: shared ? "TEAM" : null,
    },
    now,
    viewer,
  );
}
