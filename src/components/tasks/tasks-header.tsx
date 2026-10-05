"use client";

import { usePrototype } from "@/prototype/store";
import { isClosed, isOverdue } from "@/prototype/rules";
import { plural } from "@/prototype/dates";
import { PageHeader } from "@/components/page-header";
import { NewTaskButton } from "@/components/prototype/new-task";

export function TasksHeader({ title = "Задачи", description }: { title?: string; description?: string }) {
  const { data } = usePrototype();
  const open = data.tasks.filter((t) => !isClosed(t) && !t.archived);
  const overdue = open.filter((t) => isOverdue(t, data.today)).length;
  const blocked = open.filter((t) => t.state === "blocked").length;
  return (
    <PageHeader
      title={title}
      description={
        description ??
        `${open.length} ${plural(open.length, "открытая задача", "открытые задачи", "открытых задач")}, ${overdue} ${plural(overdue, "просрочена", "просрочены", "просрочено")}, ${blocked} ${plural(blocked, "заблокирована", "заблокированы", "заблокировано")}`
      }
    >
      <NewTaskButton />
    </PageHeader>
  );
}
