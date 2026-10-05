"use client";

import { usePrototype } from "@/prototype/store";
import { isClosed, isClosedThisWeek, isDueNextWeek, isDueThisWeek, isMine, isOverdue, myTasksOrder } from "@/prototype/rules";
import { EmptyState } from "@/components/empty-state";
import { TaskTable } from "./task-list";

/** Мои задачи: стартовая страница лидера. Сверху просроченные, потом срок на этой неделе, потом остальные (раздел 4 ТЗ) */
export function MyTasks() {
  const { data, me } = usePrototype();
  const mine = myTasksOrder(
    data.tasks.filter((t) => !t.archived && isMine(t, me.slug, me.role)),
    data.today,
  );
  const proposedByMe = data.tasks.filter((t) => t.status === "proposed" && t.createdBy === me.slug && t.owner !== me.slug);

  const overdue = mine.filter((t) => isOverdue(t, data.today));
  const thisWeek = mine.filter((t) => !isOverdue(t, data.today) && isDueThisWeek(t, data.today));
  const nextWeek = mine.filter((t) => !isOverdue(t, data.today) && isDueNextWeek(t, data.today));
  const rest = mine.filter((t) => !isClosed(t) && !overdue.includes(t) && !thisWeek.includes(t) && !nextWeek.includes(t));
  const closed = mine.filter((t) => isClosed(t) && isClosedThisWeek(t, data.today));

  const groups = [
    { key: "overdue", title: "Просроченные", tasks: overdue },
    { key: "week", title: "Срок на этой неделе", tasks: thisWeek },
    { key: "next", title: "Срок на следующей неделе", tasks: nextWeek },
    { key: "rest", title: "Остальные в работе", tasks: rest },
    { key: "proposed", title: "Я предложил другим", tasks: proposedByMe },
    { key: "closed", title: "Закрыто за неделю", tasks: closed },
  ].filter((g) => g.tasks.length > 0);

  if (groups.length === 0) {
    return (
      <EmptyState title="У вас нет задач">
        Поставьте себе задачу кнопкой «Новая задача» или клавишей N.
      </EmptyState>
    );
  }
  return <TaskTable groups={groups} showOwner={false} />;
}
