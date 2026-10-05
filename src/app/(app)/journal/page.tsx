import type { Metadata } from "next";
import { requireManagement } from "@/lib/auth";
import { journalEvents } from "@/lib/journal";
import { PageHeader } from "@/components/page-header";
import { JournalView } from "@/components/admin/journal-view";

export const metadata: Metadata = { title: "Журнал" };

export default async function JournalPage() {
  await requireManagement(["OWNER", "ADMIN"], "/journal");
  const live = await journalEvents();

  return (
    <>
      <PageHeader title="Журнал" description="Кто, когда и что изменил: было и стало по каждому полю" />
      <JournalView live={live} />
    </>
  );
}
