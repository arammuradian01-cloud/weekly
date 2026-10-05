import type { Metadata } from "next";
import { TaskPage } from "@/components/tasks/task-page";

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  const { number } = await params;
  return { title: `Задача ${number}` };
}

/** Постоянная ссылка на задачу: её можно кинуть в мессенджер */
export default async function TaskNumberPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return <TaskPage number={Number(number)} />;
}
