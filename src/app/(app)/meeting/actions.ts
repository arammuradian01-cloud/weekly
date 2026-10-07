"use server";

// Действия встречи 2.0 (этап 23). Права и правила проверяет сервис.

import { runAction, type Result } from "@/lib/action-runner";
import type { DecisionView, MeetingView } from "@/domain/meeting";
import type { WeekKey } from "@/domain/types";
import * as svc from "@/lib/meeting/service";

export async function buildAgendaAction(team: string, week: WeekKey): Promise<Result<MeetingView>> {
  return runAction("Повестка", (a) => svc.buildAgenda(a, String(team), week));
}

export async function addAgendaItemAction(meetingId: string, title: string, note?: string | null): Promise<Result<MeetingView>> {
  return runAction("Пункт повестки", (a) => svc.addAgendaItem(a, String(meetingId), String(title ?? ""), note == null ? null : String(note)));
}

export async function removeAgendaItemAction(meetingId: string, itemId: string): Promise<Result<MeetingView>> {
  return runAction("Пункт повестки", (a) => svc.removeAgendaItem(a, String(meetingId), String(itemId)));
}

export async function moveAgendaItemAction(meetingId: string, itemId: string, beforeId: string | null): Promise<Result<MeetingView>> {
  return runAction("Порядок повестки", (a) => svc.moveAgendaItem(a, String(meetingId), String(itemId), beforeId == null ? null : String(beforeId)));
}

export async function startMeetingAction(meetingId: string): Promise<Result<MeetingView>> {
  return runAction("Начало встречи", (a) => svc.startMeeting(a, String(meetingId)));
}

export async function goToItemAction(meetingId: string, itemId: string | null): Promise<Result<MeetingView>> {
  return runAction("Встреча", (a) => svc.goToItem(a, String(meetingId), itemId == null ? null : String(itemId)));
}

export async function setItemDiscussedAction(meetingId: string, itemId: string, discussed: boolean): Promise<Result<MeetingView>> {
  return runAction("Пункт обсуждён", (a) => svc.setItemDiscussed(a, String(meetingId), String(itemId), !!discussed));
}

export async function setTimerAction(meetingId: string, minutes: number): Promise<Result<MeetingView>> {
  return runAction("Таймер", (a) => svc.setTimer(a, String(meetingId), Number(minutes)));
}

export async function setNotionUrlAction(meetingId: string, url: string | null): Promise<Result<MeetingView>> {
  return runAction("Ссылка на Notion", (a) => svc.setNotionUrl(a, String(meetingId), url == null ? null : String(url)));
}

export async function addDecisionAction(meetingId: string, input: svc.NewDecision): Promise<Result<MeetingView>> {
  return runAction("Решение", (a) => svc.addDecision(a, String(meetingId), input));
}

export async function cancelDecisionAction(decisionId: string, reason: string): Promise<Result<DecisionView>> {
  return runAction("Решение", (a) => svc.cancelDecision(a, String(decisionId), String(reason ?? "")));
}

export async function closeMeetingAction(meetingId: string): Promise<Result<MeetingView>> {
  return runAction("Закрытие встречи", (a) => svc.closeMeeting(a, String(meetingId)));
}

export async function reopenMeetingAction(meetingId: string): Promise<Result<MeetingView>> {
  return runAction("Встреча", (a) => svc.reopenMeeting(a, String(meetingId)));
}

export async function meetingAction(team: string, week: WeekKey): Promise<Result<MeetingView | null>> {
  return runAction("Встреча", (a) => svc.getMeeting(a, String(team), week));
}

export async function searchDecisionsAction(query: string, status: "active" | "cancelled" | "all", teamIds?: string[]): Promise<Result<DecisionView[]>> {
  return runAction("Поиск решений", (a) => svc.listDecisions(a, { query: String(query ?? ""), status, teamIds: teamIds?.map(String) }));
}

export async function intakeAction(meetingId: string, items: svc.IntakeItem[], notionUrl?: string | null): Promise<Result<{ meeting: MeetingView; tasks: number[]; decisions: number }>> {
  return runAction("Приём из Notion", (a) => svc.intake(a, String(meetingId), items, notionUrl));
}
