import type { Metadata } from "next";
import { requireManagement } from "@/lib/auth";
import { OWNER_ROLES } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { SyncStatus } from "@/components/admin/sync-status";

export const metadata: Metadata = { title: "Синхронизация" };

export default async function SyncPage() {
  await requireManagement(OWNER_ROLES, "/sync");
  const [tasks, comments, entries] = await Promise.all([prisma.task.count(), prisma.taskComment.count(), prisma.weeklyEntry.count()]);
  return (
    <>
      <PageHeader title="Синхронизация" description="Зеркало задач и weekly в Google-таблицу Insurance&Invest Bord, в одну сторону" />
      <SyncStatus counts={{ tasks, comments, entries }} />
    </>
  );
}
