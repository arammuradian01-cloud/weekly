import type { Metadata } from "next";
import { TaskPage } from "@/components/tasks/task-page";
import { requireContext } from "@/lib/auth";
import { getTask } from "@/lib/tasks/service";

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  const { number } = await params;
  return { title: `Задача ${number}` };
}

/**
 * Постоянная ссылка на задачу: её можно кинуть в мессенджер. Задача другой видимой команды
 * может не попасть в задачи выбранной команды, поэтому страница берёт её с сервера сама (этап 14)
 */
export default async function TaskNumberPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const n = Number(number);
  const ctx = await requireContext();
  const task = Number.isInteger(n) && n > 0 ? await getTask(n, { personId: ctx.person.id, role: ctx.person.role }) : null;
  const visible = task && (!task.archived || ctx.management?.role === "OWNER") ? task : null;
  return <TaskPage number={n} initial={visible} />;
}
