import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Задачи" };

export default async function TasksPage() {
  await requireContext();
  return (
    <>
      <PageHeader title="Задачи" description="Общий список задач команды" />
      <EmptyState title="Список задач пока пустой" stage="Этап 3">
        Сюда переедет вкладка «Задачи» из Insurance&amp;Invest Bord: 51 задача с теми же номерами, новые начнутся с 52. Статус, состояние и приоритет будут меняться прямо в строке.
      </EmptyState>
    </>
  );
}
