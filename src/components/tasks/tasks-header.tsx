"use client";

// Шапка раздела «Задачи». Этап 36: ключевые цифры плитками под заголовком вместо фразы, каждая ведёт на список с
// быстрым фильтром

import { usePrototype } from "@/domain/store";
import { isClosed } from "@/domain/rules";
import { quickPredicate } from "@/lib/tasks/list-params";
import { PageHeader } from "@/components/page-header";
import { Figures } from "@/components/ui/data";
import { NewTaskButton } from "@/components/prototype/new-task";

export function TasksHeader({ title = "Задачи", description }: { title?: string; description?: string }) {
  const { data, me } = usePrototype();
  const open = data.teamTasks.filter((t) => !isClosed(t) && !t.archived);
  const count = (key: Parameters<typeof quickPredicate>[0]) => open.filter(quickPredicate(key, me, data.today)).length;
  return (
    <PageHeader
      title={title}
      description={description ?? "Задачи выбранной команды и ваши задачи в других командах. Цифры ведут на список с фильтром"}
      figures={
        <Figures
          label="Задачи в цифрах"
          items={[
            { label: "Открыто", value: open.length, href: "/tasks", testId: "tasks-fig-open" },
            { label: "Просрочено", value: count("overdue"), href: "/tasks?f=overdue", tone: "danger", testId: "tasks-fig-overdue" },
            { label: "Заблокировано", value: count("blocked"), href: "/tasks?f=blocked", tone: "warning", testId: "tasks-fig-blocked" },
            { label: "Срок на этой неделе", value: count("week"), href: "/tasks?f=week", testId: "tasks-fig-week" },
            { label: "Давно без обновлений", value: count("stale"), href: "/tasks?f=stale", tone: "warning", testId: "tasks-fig-stale" },
          ]}
        />
      }
    >
      <div className="lg:hidden">
        <NewTaskButton />
      </div>
    </PageHeader>
  );
}
