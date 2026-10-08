"use client";

// Поля задачи, которые меняются в один клик: и в строке списка, и в карточке.

import { PRIORITIES, STATES, STATUSES, priorityOf, stateLabel } from "@/domain/dictionaries";
import { permissions, type Viewer } from "@/lib/tasks/rules";
import { usePrototype } from "@/domain/store";
import { teamOf, teamPeople } from "@/domain/teams";
import type { Task } from "@/domain/types";
import { InlineSelect } from "@/components/ui/overlays";
import { PriorityTag, StateDot, StatusBadge } from "@/components/ui/task-badges";
import { useTaskActions } from "./task-actions";
import { greenOutside } from "@/lib/tasks/green-outside";

export function useViewer(): Viewer {
  const { me, manageRole, observer, leads } = usePrototype();
  // Люди команд, которыми руководит (этап 16): по снимку команд, как и на сервере
  const people = [...new Set(leads.flatMap((id) => (teamOf(id) ? teamPeople(teamOf(id)!) : [])))].filter((s) => s !== me.slug);
  return { slug: me.slug, management: manageRole, observer, leads, employee: me.role === "EMPLOYEE", people };
}

export function useTaskPermissions(task: Task) {
  return permissions(task, useViewer());
}

/** subject: чей статус для экранного диктора, когда задач на экране несколько, например «задачи 47» */
export function StatusSelect({ task, subject }: { task: Task; subject?: string }) {
  const actions = useTaskActions();
  const can = useTaskPermissions(task);
  // «Предложена» выставляет только система: лидер предлагает задачу, владелец или администратор её принимает
  // Адресат предложенной задачи (этап 16) только принимает её или отклоняет
  const decideOnly = task.status === "proposed" && can.confirm && !can.status;
  const options = STATUSES.filter((s) => (s.code !== "proposed" || task.status === "proposed") && (!decideOnly || ["proposed", "in-progress", "cancelled"].includes(s.code))).map((s) => ({
    value: s.code,
    label: s.label,
  }));
  return (
    <InlineSelect
      label="Статус"
      ariaSubject={subject}
      value={task.status}
      options={options}
      disabled={task.status === "proposed" ? !can.confirm : !can.status}
      onChange={(v) => actions.changeStatus(task, v)}
      render={(v) => <StatusBadge status={v} />}
    />
  );
}

export function StateSelect({ task, subject }: { task: Task; subject?: string }) {
  const actions = useTaskActions();
  const can = useTaskPermissions(task);
  const { data } = usePrototype();
  // 14 дней без обновления «где сейчас»: «В графике» не считается, пока его не подтвердят обновлением (этап 22)
  const unconfirmed = greenOutside(task, data.today)?.unconfirmed ?? false;
  return (
    <InlineSelect
      label="Состояние"
      ariaSubject={subject}
      value={task.state}
      valueLabel={unconfirmed ? "В графике не подтверждено" : stateLabel(task.state)}
      render={(v) => <StateDot state={v} />}
      renderValue={(v) => (unconfirmed && v === "on-track" ? <StateDot state="unset" label="В графике не подтверждено" /> : <StateDot state={v} />)}
      options={STATES.map((s) => ({ value: s.code, label: s.label }))}
      disabled={!can.state}
      onChange={(v) => actions.changeState(task, v)}
    />
  );
}

export function PrioritySelect({ task }: { task: Task }) {
  const actions = useTaskActions();
  const can = useTaskPermissions(task);
  return (
    <InlineSelect
      label="Приоритет"
      value={task.priority}
      valueLabel={priorityOf(task.priority).label}
      options={PRIORITIES.map((p) => ({ value: p.code, label: p.label }))}
      disabled={!can.priority}
      onChange={(v) => actions.changePriority(task, v)}
      render={(v) => <PriorityTag priority={v} />}
    />
  );
}
