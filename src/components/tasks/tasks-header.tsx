"use client";

import { usePrototype } from "@/domain/store";
import { isClosed, isOverdue } from "@/domain/rules";
import { plural } from "@/domain/dates";
import { PageHeader } from "@/components/page-header";
import { NewTaskButton } from "@/components/prototype/new-task";

export function TasksHeader({ title = "Задачи", description }: { title?: string; description?: string }) {
  const { data } = usePrototype();
  const open = data.teamTasks.filter((t) => !isClosed(t) && !t.archived);
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
      <div className="lg:hidden">
        <NewTaskButton />
      </div>
    </PageHeader>
  );
}
