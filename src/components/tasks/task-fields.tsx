"use client";

// Поля задачи, которые меняются в один клик: и в строке списка, и в карточке.

import { PRIORITIES, STATES, STATUSES, priorityOf, stateLabel } from "@/domain/dictionaries";
import { permissions, type Viewer } from "@/lib/tasks/rules";
import { usePrototype } from "@/domain/store";
import type { Task } from "@/domain/types";
import { InlineSelect } from "@/components/ui/overlays";
import { PriorityTag, StateDot, StatusBadge } from "@/components/ui/task-badges";
import { useTaskActions } from "./task-actions";

export function useViewer(): Viewer {
  const { me, manageRole, observer, leads } = usePrototype();
  return { slug: me.slug, management: manageRole, observer, leads };
}

export function useTaskPermissions(task: Task) {
  return permissions(task, useViewer());
}

export function StatusSelect({ task }: { task: Task }) {
  const actions = useTaskActions();
  const can = useTaskPermissions(task);
  // «Предложена» выставляет только система: лидер предлагает задачу, владелец или администратор её принимает
  const options = STATUSES.filter((s) => s.code !== "proposed" || task.status === "proposed").map((s) => ({ value: s.code, label: s.label }));
  return (
    <InlineSelect
      label="Статус"
      value={task.status}
      options={options}
      disabled={task.status === "proposed" ? !can.confirm : !can.status}
      onChange={(v) => actions.changeStatus(task, v)}
      render={(v) => <StatusBadge status={v} />}
    />
  );
}

export function StateSelect({ task }: { task: Task }) {
  const actions = useTaskActions();
  const can = useTaskPermissions(task);
  return (
    <InlineSelect
      label="Состояние"
      value={task.state}
      valueLabel={stateLabel(task.state)}
      options={STATES.map((s) => ({ value: s.code, label: s.label }))}
      disabled={!can.state}
      onChange={(v) => actions.changeState(task, v)}
      render={(v) => <StateDot state={v} />}
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
