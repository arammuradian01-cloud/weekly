import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireManagement } from "@/lib/auth";
import { AUDIT_ACTION_LABELS } from "@/lib/audit";
import { formatDateTime } from "@/lib/week";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { JournalView } from "@/components/admin/journal-view";

export const metadata: Metadata = { title: "Журнал" };

const SOURCE_LABELS = { APP: "ресурс", SHEET: "таблица", SYSTEM: "система" } as const;

export default async function JournalPage() {
  await requireManagement(["OWNER", "ADMIN"], "/journal");
  const events = await prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: 50 });

  return (
    <>
      <PageHeader title="Журнал" description="Кто, когда и что изменил: было и стало по каждому полю" />
      <JournalView />

      <details className="mt-10 rounded-xl ring-1 ring-line">
        <summary className="cursor-pointer select-none px-5 py-4 text-[15px] font-semibold text-ink">
          Живые события ресурса <span className="font-normal text-muted">входы и настройка паролей, последние 50</span>
        </summary>
        <div className="px-5 pb-5">
          {events.length === 0 ? (
            <EmptyState title="Событий пока нет" />
          ) : (
            <div className="overflow-x-auto rounded-xl ring-1 ring-line">
              <table className="w-full min-w-[640px] text-left text-[14px]">
                <thead className="bg-surface text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Когда</th>
                    <th scope="col" className="px-4 py-3 font-medium">Кто</th>
                    <th scope="col" className="px-4 py-3 font-medium">Что</th>
                    <th scope="col" className="px-4 py-3 font-medium">Откуда</th>
                    <th scope="col" className="px-4 py-3 font-medium">Адрес</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {events.map((e) => (
                    <tr key={e.id.toString()}>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted">{formatDateTime(e.at)}</td>
                      <td className="px-4 py-3 text-ink">{e.actorName ?? (e.source === "SYSTEM" ? "Система" : "Профиль не выбран")}</td>
                      <td className="px-4 py-3 text-ink">{AUDIT_ACTION_LABELS[e.action] ?? e.action}</td>
                      <td className="px-4 py-3 text-muted">{SOURCE_LABELS[e.source]}</td>
                      <td className="px-4 py-3 text-muted">{e.ip ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    
        </div>
      </details>
    </>
  );
}
