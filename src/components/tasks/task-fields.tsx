"use client";

// Поля задачи, которые меняются в один клик: и в строке списка, и в карточке.

import { PRIORITIES, STATES, STATUSES } from "@/prototype/dictionaries";
import { permissions } from "@/prototype/rules";
import { usePrototype } from "@/prototype/store";
import type { Task } from "@/prototype/types";
import { InlineSelect } from "@/components/ui/overlays";
import { PriorityTag, StateDot, StatusBadge } from "@/components/ui/task-badges";
import { useTaskActions } from "./task-actions";

export function useTaskPermissions(task: Task) {
  const { me, manage } = usePrototype();
  return permissions(task, me.slug, manage);
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
      disabled={!can.status}
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
      options={PRIORITIES.map((p) => ({ value: p.code, label: p.label }))}
      disabled={!can.priority}
      onChange={(v) => actions.changePriority(task, v)}
      render={(v) => <PriorityTag priority={v} />}
    />
  );
}
