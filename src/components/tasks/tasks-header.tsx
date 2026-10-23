"use client";

// Шапка раздела «Задачи». Этап 36: ключевые цифры под заголовком, каждая ведёт на список с быстрым фильтром.
// Этап 42: цифры строкой, а не плитками, нули не показываются, в строке не больше трёх: чипы быстрых фильтров ниже
// и так дают счёт по каждому отбору. Этап 68: подпись короче, без объяснения, как работают цифры. Кнопка «Новая задача»
// на планшете и телефоне остаётся: в шапке сайта на этих экранах её нет

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
      description={description ?? "Задачи выбранной команды и ваши задачи в других командах"}
      figures={
        <Figures
          label="Задачи в цифрах"
          inline
          max={3}
          items={[
            { label: "открыто", value: open.length, href: "/tasks", testId: "tasks-fig-open", keepZero: true },
            { label: "просрочено", value: count("overdue"), href: "/tasks?f=overdue", tone: "danger", testId: "tasks-fig-overdue" },
            { label: "заблокировано", value: count("blocked"), href: "/tasks?f=blocked", tone: "warning", testId: "tasks-fig-blocked" },
            { label: "срок на этой неделе", value: count("week"), href: "/tasks?f=week", testId: "tasks-fig-week" },
            { label: "давно без обновлений", value: count("stale"), href: "/tasks?f=stale", tone: "warning", testId: "tasks-fig-stale" },
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
