"use client";

// Цель в форме новой задачи (этап 55). Решение Арама 21.10: цель подтягивается сама по сути задачи, её можно
// поменять, найти другую поиском или убрать. Подбор идёт на сервере по целям, которые задаче можно дать: своей
// команды и команд выше на квартал сегодня и квартал срока, личные цели ответственного.

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { suggestGoalsAction } from "@/app/(app)/goals/actions";
import type { GoalOption } from "@/lib/goals/service";
import { SearchPicker } from "@/components/ui/search-picker";

type Suggestion = { options: GoalOption[]; best: string | null };

/** Пока человек печатает, подбор ждёт паузу: не дёргаем сервер на каждую букву */
const PAUSE_MS = 350;

export function NewTaskGoal({
  team,
  due,
  title,
  outcome,
  owner,
  goal,
  manual,
  onAuto,
  onPick,
}: {
  team: string;
  due: string;
  title: string;
  outcome: string;
  owner: string;
  /** Выбранная цель, пустая строка: без цели */
  goal: string;
  /** Человек выбрал или убрал цель сам: подбор по тексту её больше не меняет */
  manual: boolean;
  /** Подбор по тексту подставил цель или снял ту, что больше не подходит */
  onAuto: (goal: string) => void;
  /** Человек выбрал цель в поиске или убрал её */
  onPick: (goal: string) => void;
}) {
  const [state, setState] = useState<Suggestion | null>(null);
  const seq = useRef(0);

  // Свежий ответ сервера: сами подставляем лучшую цель, пока человек не выбрал. Выбранная вручную цель остаётся,
  // если она всё ещё подходит; сменили команду или срок и её больше нет в списке: подбираем заново
  const apply = useEffectEvent((r: Suggestion) => {
    setState(r);
    if (!manual) {
      if (goal !== (r.best ?? "")) onAuto(r.best ?? "");
    } else if (goal && !r.options.some((o) => o.id === goal)) {
      onAuto(r.best ?? "");
    }
  });
  const first = state === null;

  useEffect(() => {
    const n = ++seq.current;
    const timer = setTimeout(
      async () => {
        try {
          const r = await suggestGoalsAction({ team, due, title, outcome, owner });
          // Ответ на старый текст не перетирает более свежий
          if (n !== seq.current) return;
          apply(r.ok ? r.value : { options: [], best: null });
        } catch {
          // Нет связи: форма работает без подбора, задачу можно поставить без цели
          if (n === seq.current) setState((s) => s ?? { options: [], best: null });
        }
      },
      first ? 0 : PAUSE_MS,
    );
    return () => clearTimeout(timer);
    // first нужен только для задержки первого запроса, повторять запрос при его смене не надо
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, due, title, outcome, owner]);

  if (!state) return null;
  if (!state.options.length) {
    return (
      <p className="text-small text-muted sm:col-span-2" data-testid="nt-goal-none">
        Целей у команды задачи и команд выше на этот квартал нет: задача будет без цели
      </p>
    );
  }

  const suggested = state.options.some((o) => o.suggested);
  const hint = goal
    ? manual
      ? undefined
      : "Подобрана по тексту задачи. Можно выбрать другую или убрать"
    : suggested
      ? "Подходящие по тексту цели вверху списка. Можно оставить без цели"
      : "Найдите цель по названию или коду или оставьте без цели";

  return (
    <div className="flex flex-col gap-1 sm:col-span-2" data-testid="nt-goal">
      <SearchPicker
        id="nt-goal"
        label="Цель"
        options={state.options.map((o) => ({ value: o.id, label: o.title, hint: o.context, note: o.suggested ? "по тексту" : null }))}
        value={goal}
        onChange={onPick}
        placeholder="Название или код цели"
        emptyText="Такой цели нет: проверьте написание"
        hint={hint}
      />
      {goal ? (
        <button type="button" onClick={() => onPick("")} className="self-start text-small font-medium text-blue-700 hover:underline">
          Без цели
        </button>
      ) : null}
    </div>
  );
}
