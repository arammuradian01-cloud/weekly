"use client";

// Цель задачи в карточке (этап 17): на какую цель команды или команды выше работает задача.

import Link from "next/link";
import { useState } from "react";
import { Target } from "lucide-react";
import type { Task } from "@/domain/types";
import { usePrototype } from "@/domain/store";
import { goalOptionsAction, linkGoalAction } from "@/app/(app)/goals/actions";
import { SelectField } from "@/components/ui/primitives";

export function TaskGoal({ task, canLink }: { task: Task; canLink: boolean }) {
  const { notify } = usePrototype();
  const [options, setOptions] = useState<{ id: string; label: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    const r = await goalOptionsAction(task.number);
    if (!r.ok) return notify(r.error, "error");
    setOptions(r.value);
  };
  const choose = async (goalId: string) => {
    setBusy(true);
    const r = await linkGoalAction(task.number, goalId || null);
    setBusy(false);
    if (!r.ok) return notify(r.error, "error");
    setOptions(null);
    notify(r.value.goal ? `Задача работает на цель: ${r.value.goal}` : "Задача отвязана от цели");
  };

  return (
    <div className="flex flex-col gap-1">
      {task.goal ? (
        <Link href={`/goals#goal-${task.goal.id}`} className="inline-flex items-start gap-1.5 text-body text-ink hover:underline">
          <Target className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          {task.goal.title}
        </Link>
      ) : (
        <span className="text-muted">Без цели</span>
      )}
      {canLink && !options ? (
        <button type="button" onClick={open} className="self-start text-small font-medium text-blue-700 hover:underline">
          {task.goal ? "Сменить цель" : "Выбрать цель"}
        </button>
      ) : null}
      {options ? (
        options.length ? (
          <SelectField
            label="Цель команды или команды выше"
            id={`goal-${task.number}`}
            value={task.goal?.id ?? ""}
            disabled={busy}
            onChange={(e) => void choose(e.target.value)}
            options={[{ value: "", label: "Без цели" }, ...options.map((o) => ({ value: o.id, label: o.label }))]}
          />
        ) : (
          <p className="text-small text-muted">
            Целей у команды задачи и команд выше на этот квартал нет. Их заводят на странице{" "}
            <Link href="/goals" className="text-blue-700 hover:underline">
              «Цели»
            </Link>
            .
          </p>
        )
      ) : null}
    </div>
  );
}
