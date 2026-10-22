"use client";

// Карточка weekly-команды (этап 64): панель справа на ноутбуке, отдельный экран на телефоне. Участники списком с ролью
// и подразделением, ждущие согласия, руководитель, сдача weekly и срок. Кнопки только те, что разрешает сервер;
// чего нет и почему, говорит одна строка под заголовком (например, что руководителя назначают в режиме управления).

import { useState } from "react";
import { ArrowLeft, CalendarClock, Pencil, UserCog, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/primitives";
import { PersonName, initialsOf } from "@/components/people/person-card";
import { useRunWeekly } from "@/components/weekly/use-weekly";
import { cancelRequestAction, removeMemberAction } from "@/app/(app)/people/teams/actions";
import type { TeamPerson, WeeklyTeam, WeeklyTeamsView } from "@/lib/org/teams";
import { sizeText, teamKindLabel, teamNote, teamSize } from "@/lib/org/team-rights";
import { plural } from "@/domain/dates";
import { cn } from "@/lib/cn";
import { WeeklyLine, rhythmText } from "./weekly-line";
import { ManageHint } from "./manage-hint";

export type CardAction = "add" | "rename" | "close" | "leader" | "rhythm";

/** Кнопки на телефоне не ниже 44 точек: в них попадают пальцем */
const touch = "max-sm:min-h-11";

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
        <Button size="sm" variant="ghost" className={touch} disabled={busy} onClick={onRemove} aria-label={`Убрать из команды: ${person.fullName}`}>
          Убрать
        </Button>
      ) : null}
    </li>
  );
}

export function TeamCard({ team, view, onAction, onBack, className }: { team: WeeklyTeam; view: Pick<WeeklyTeamsView, "mode" | "managementOff">; onAction: (action: CardAction) => void; /** Телефон: вернуться к списку */ onBack: () => void; className?: string }) {
  const run = useRunWeekly();
  const [busy, setBusy] = useState(false);
  const r = team.rights;
  const note = teamNote({ mode: view.mode, off: view.managementOff }, team);
  const size = teamSize(team);

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
      <button type="button" onClick={onBack} className="-ml-1 mb-2 inline-flex min-h-11 items-center gap-1.5 px-1 text-small font-medium text-link hover:underline lg:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />К списку команд
      </button>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-caption text-muted">
          <Badge tone={team.kind === "CUSTOM" ? "blue" : "gray"}>{teamKindLabel(team)}</Badge>
          {team.relation === "below" ? <span>Команда ниже вашей</span> : null}
          {team.parent ? <span>Команда выше: {team.parent.name}</span> : null}
        </div>
        <h2 id="team-card-title" tabIndex={-1} className="min-w-0 break-words text-title font-semibold text-ink outline-none focus-visible:rounded-control focus-visible:ring-2 focus-visible:ring-focus">
          {team.name}
        </h2>
        {r.rename || r.leader || r.rhythm ? (
          <div className="flex flex-wrap gap-2" data-testid="team-card-actions">
            {r.leader ? (
              <Button size="sm" variant="secondary" className={touch} onClick={() => onAction("leader")}>
                <UserCog className="h-4 w-4" aria-hidden="true" />
                Назначить руководителя
              </Button>
            ) : null}
            {r.rhythm ? (
              <Button size="sm" variant="secondary" className={touch} onClick={() => onAction("rhythm")}>
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                Кто сдаёт и срок
              </Button>
            ) : null}
            {r.rename ? (
              <Button size="sm" variant="secondary" className={touch} onClick={() => onAction("rename")}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Переименовать
              </Button>
            ) : null}
          </div>
        ) : null}
        {note ? (
          note.manage ? (
            <ManageHint text={note.text} />
          ) : (
            <p className="text-small text-muted" data-testid="team-card-readonly">
              {note.text}
            </p>
          )
        ) : null}
      </header>

      <dl className="mt-4 grid gap-4 rounded-control-lg border border-line p-3 sm:p-4">
        <div className="min-w-0">
          <dt className="text-caption text-muted">Руководитель</dt>
          <dd className="mt-1 text-body text-ink">{team.relation === "leader" && team.leader ? `${team.leader.fullName}, это вы` : team.leader ? team.leader.fullName : "Не назначен"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-muted">Weekly за отчётную неделю</dt>
          <dd className="mt-1 flex flex-col items-start gap-1">
            <WeeklyLine weekly={team.weekly} />
            <span className="text-small text-muted">{rhythmText(team)}</span>
          </dd>
        </div>
      </dl>

      <section className="mt-5" aria-labelledby="team-members-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="team-members-title" className="text-title-sm font-semibold text-ink">
            Участники <span className="text-small font-normal text-muted">{sizeText(size)}, с руководителем</span>
          </h3>
          {r.members ? (
            <Button size="sm" className={touch} onClick={() => onAction("add")}>
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
        {!team.members.length ? <p className="mt-2 text-small text-muted">{r.members ? "Участников пока нет: нажмите «Добавить участников»." : "Участников пока нет."}</p> : null}
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
                  <Button size="sm" variant="ghost" className={touch} disabled={busy} onClick={() => void cancel(w.id, w.fullName)} aria-label={`Отменить запрос: ${w.fullName}`}>
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
          <Button size="sm" variant="danger" className={cn("self-start", touch)} onClick={() => onAction("close")}>
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
