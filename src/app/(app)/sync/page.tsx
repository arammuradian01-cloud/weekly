import type { Metadata } from "next";
import { requireManagement } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Синхронизация" };

export default async function SyncPage() {
  await requireManagement(["OWNER"], "/sync");
  return (
    <>
      <PageHeader title="Синхронизация" description="Зеркало задач и weekly в Google-таблицу Insurance&Invest Bord" />
      <EmptyState title="Зеркало ещё не подключено" stage="Этап 6">
        Сначала подключим копию таблицы. Здесь будут время последней выгрузки, длина очереди, ошибки и кнопки «Выгрузить сейчас» и «Пересобрать вкладки».
      </EmptyState>
    </>
  );
}
