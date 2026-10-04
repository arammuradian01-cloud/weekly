import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireManagement } from "@/lib/auth";
import { AUDIT_ACTION_LABELS } from "@/lib/audit";
import { formatDateTime } from "@/lib/week";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Журнал" };

const SOURCE_LABELS = { APP: "ресурс", SHEET: "таблица", SYSTEM: "система" } as const;

export default async function JournalPage() {
  await requireManagement(["OWNER", "ADMIN"], "/journal");
  const events = await prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: 200 });

  return (
    <>
      <PageHeader
        title="Журнал"
        description="Последние 200 событий. Журнал только дописывается: править и удалять записи нельзя даже в базе. Фильтры появятся на этапе 5."
      />
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
    </>
  );
}
