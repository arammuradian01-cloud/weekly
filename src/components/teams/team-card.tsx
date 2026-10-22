"use client";

// Карточка weekly-команды (этап 64): панель справа на ноутбуке, отдельный экран на телефоне. Участники списком с ролью
// и подразделением, ждущие согласия, руководитель, сдача weekly и срок. Кнопки только те, что разрешает сервер.

import { useState } from "react";
import { ArrowLeft, Pencil, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/primitives";
import { PersonName, initialsOf } from "@/components/people/person-card";
import { useRunWeekly } from "@/components/weekly/use-weekly";
import { cancelRequestAction, removeMemberAction } from "@/app/(app)/people/teams/actions";
import type { TeamPerson, WeeklyTeam } from "@/lib/org/teams";
import { teamKindLabel } from "@/lib/org/team-rights";
import { plural } from "@/domain/dates";
import { cn } from "@/lib/cn";
import { WeeklyLine, rhythmText } from "./weekly-line";

export type CardAction = "add" | "rename" | "close" | "leader" | "rhythm";

function MemberRow({ person, role, external, busy, onRemove }: { person: TeamPerson; role: string; external?: boolean; busy?: boolean; onRemove?: () => void }) {
  const where = [person.position, person.unit].filter(Boolean).join(", ");
  return (
    <li className="flex items-center gap-3 py-2.5" data-testid={`member-${person.slug}`}>
      <Avatar text={initialsOf(person.fullName)} name={person.fullName} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body text-ink">
          <PersonName slug={person.slug} name={person.fullName} className="font-medium" />
          <span className="text-caption text-muted">{role}</span>
          {external ? (
            <Badge tone="yellow" className="text-caption">
              другая ветка
            </Badge>
          ) : null}
        </p>
        <p className="truncate text-small text-muted">{where || "Должность не указана"}</p>
      </div>
      {onRemove ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove} aria-label={`Убрать из команды: ${person.fullName}`}>
          Убрать
        </Button>
      ) : null}
    </li>
  );
}

export function TeamCard({ team, onAction, onBack, className }: { team: WeeklyTeam; onAction: (action: CardAction) => void; /** Телефон: вернуться к списку */ onBack: () => void; className?: string }) {
  const run = useRunWeekly();
  const [busy, setBusy] = useState(false);
  const r = team.rights;
  const editable = r.members || r.rename || r.close || r.leader || r.rhythm;
  const count = team.members.length;

  const remove = async (slug: string, fullName: string) => {
    setBusy(true);
    await run(() => removeMemberAction(team.id, slug), `${fullName} убран из команды`);
    setBusy(false);
  };
  const cancel = async (id: string, fullName: string) => {
    setBusy(true);
    await run(() => cancelRequestAction(id), `Запрос отменён: ${fullName}`);
    setBusy(false);
  };

  return (
    <section aria-labelledby="team-card-title" className={cn("sv-card bg-surface p-4 sm:p-5", className)} data-testid="team-card">
      <button type="button" onClick={onBack} className="mb-3 inline-flex min-h-9 items-center gap-1.5 text-small font-medium text-link hover:underline lg:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />К списку команд
      </button>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-caption text-muted">
          <Badge tone={team.kind === "CUSTOM" ? "blue" : "gray"}>{teamKindLabel(team)}</Badge>
          {team.parent ? <span>Команда выше: {team.parent.name}</span> : null}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 id="team-card-title" className="min-w-0 break-words text-title font-semibold text-ink">
            {team.name}
          </h2>
          {r.rename ? (
            <Button size="sm" variant="secondary" onClick={() => onAction("rename")}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Переименовать
            </Button>
          ) : null}
        </div>
        {!editable ? (
          <p className="text-small text-muted" data-testid="team-card-readonly">
            Только просмотр: состав меняют руководитель команды и владелец в режиме управления.
          </p>
        ) : null}
      </header>

      <dl className="mt-4 grid gap-4 rounded-control-lg border border-line p-3 sm:p-4">
        <div className="min-w-0">
          <dt className="text-caption text-muted">Руководитель</dt>
          <dd className="mt-1 flex flex-col items-start gap-1">
            <span className="text-body text-ink">{team.leader ? team.leader.fullName : "Не назначен"}</span>
            {r.leader ? (
              <button type="button" onClick={() => onAction("leader")} className="min-h-7 text-small font-medium text-link hover:underline">
                Назначить руководителя
              </button>
            ) : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-muted">Weekly за отчётную неделю</dt>
          <dd className="mt-1 flex flex-col items-start gap-1">
            <WeeklyLine weekly={team.weekly} />
            <span className="text-small text-muted">{rhythmText(team)}</span>
            {r.rhythm ? (
              <button type="button" onClick={() => onAction("rhythm")} className="min-h-7 text-small font-medium text-link hover:underline">
                Кто сдаёт и срок
              </button>
            ) : null}
          </dd>
        </div>
      </dl>

      <section className="mt-5" aria-labelledby="team-members-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="team-members-title" className="text-title-sm font-semibold text-ink">
            Участники <span className="font-normal text-muted">{count + (team.leader ? 1 : 0)}</span>
          </h3>
          {r.members ? (
            <Button size="sm" onClick={() => onAction("add")}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Добавить участников
            </Button>
          ) : null}
        </div>
        <ul className="m-0 mt-1 list-none divide-y divide-line p-0" aria-label={`Участники команды «${team.name}»`} data-testid="team-members">
          {team.leader ? <MemberRow person={team.leader} role="руководитель" /> : null}
          {team.members.map((m) => (
            <MemberRow key={m.slug} person={m} role="участник" external={m.external} busy={busy} onRemove={r.members ? () => void remove(m.slug, m.fullName) : undefined} />
          ))}
        </ul>
        {!count ? <p className="mt-2 text-small text-muted">{r.members ? "Участников пока нет: нажмите «Добавить участников»." : "Участников пока нет."}</p> : null}
      </section>

      {team.waiting.length ? (
        <section className="mt-5" aria-labelledby="team-waiting-title" data-testid="team-waiting">
          <h3 id="team-waiting-title" className="text-title-sm font-semibold text-ink">
            Ждут согласия руководителя <span className="font-normal text-muted">{team.waiting.length}</span>
          </h3>
          <p className="mt-0.5 text-small text-muted">Человек из другой ветки войдёт в команду, когда согласится его руководитель.</p>
          <ul className="m-0 mt-1 list-none divide-y divide-line p-0">
            {team.waiting.map((w) => (
              <li key={w.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-body text-ink">{w.fullName}</p>
                  <p className="text-small text-muted">
                    согласует {w.approver}
                    {w.requestedBy ? `, просит ${w.requestedBy}` : ""}
                  </p>
                </div>
                {w.canCancel ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel(w.id, w.fullName)} aria-label={`Отменить запрос: ${w.fullName}`}>
                    Отменить
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {r.close ? (
        <footer className="mt-6 flex flex-col gap-1 border-t border-line pt-4">
          <Button size="sm" variant="danger" className="self-start" onClick={() => onAction("close")}>
            Закрыть команду
          </Button>
          {team.openTasks ? (
            <p className="text-caption text-muted">
              В команде {team.openTasks} {plural(team.openTasks, "открытая задача", "открытые задачи", "открытых задач")}: закрыть можно, когда их не останется.
            </p>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
