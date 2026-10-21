"use client";

// Цель задачи в карточке (этап 17): на какую цель команды или команды выше работает задача. С этапа 55 выбор с
// поиском по названию и коду, подходящие по тексту задачи цели вверху списка.

import Link from "next/link";
import { useState } from "react";
import { Target } from "lucide-react";
import type { Task } from "@/domain/types";
import { usePrototype } from "@/domain/store";
import { goalOptionsAction, linkGoalAction } from "@/app/(app)/goals/actions";
import type { GoalOption } from "@/lib/goals/service";
import { SearchPicker } from "@/components/ui/search-picker";

export function TaskGoal({ task, canLink }: { task: Task; canLink: boolean }) {
  const { notify } = usePrototype();
  const [options, setOptions] = useState<GoalOption[] | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    const r = await goalOptionsAction(task.number);
    if (!r.ok) return notify(r.error, "error");
    setOptions(r.value);
  };
  const choose = async (goalId: string) => {
    if (busy) return;
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
          <div className="flex flex-col gap-2" data-testid="task-goal-picker">
            {/* Кнопки над полем: открытый список целей не закрывает их */}
            <div className="flex flex-wrap gap-4">
              {task.goal ? (
                <button type="button" disabled={busy} onClick={() => void choose("")} className="text-small font-medium text-blue-700 hover:underline">
                  Отвязать от цели
                </button>
              ) : null}
              <button type="button" onClick={() => setOptions(null)} className="text-small font-medium text-muted hover:underline">
                Отмена
              </button>
            </div>
            <SearchPicker
              id={`task-goal-${task.number}`}
              label="Цель команды, команды выше или личная цель"
              options={options.map((o) => ({ value: o.id, label: o.title, hint: o.context, note: o.suggested ? "по тексту" : null }))}
              value={task.goal?.id ?? ""}
              // Пока человек печатает, поле сбрасывает выбор: цель меняется только выбором из списка, снимается кнопкой
              onChange={(id) => {
                if (id && id !== task.goal?.id) void choose(id);
              }}
              placeholder="Название или код цели"
              emptyText="Такой цели нет: проверьте написание"
              hint={options.some((o) => o.suggested) ? "Подходящие по тексту задачи цели вверху списка" : undefined}
              autoFocus
            />
          </div>
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
