import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireContext } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roles";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Команда" };

export default async function TeamPage() {
  const { person: me } = await requireContext();
  const people = await prisma.person.findMany({ orderBy: { sortOrder: "asc" }, include: { defaultDirection: true } });
  const active = people.filter((p) => p.active);
  const inactive = people.filter((p) => !p.active);

  return (
    <>
      <PageHeader
        title="Команда"
        description={`${active.length} человек в ресурсе. Сводка по задачам каждого появится на этапе 3.`}
      />
      <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
        {active.map((p) => (
          <li key={p.id} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[16px] font-semibold text-ink">{p.fullName}</span>
                {p.id === me.id ? <span className="text-[13px] text-muted">это вы</span> : null}
              </div>
              <div className="text-[14px] text-muted">{p.zone}</div>
            </div>
            <Badge tone={p.role === "OWNER" ? "navy" : p.role === "ADMIN" ? "outline" : "gray"}>{ROLE_LABELS[p.role]}</Badge>
          </li>
        ))}
      </ul>
      {inactive.length ? (
        <p className="mt-4 text-[14px] text-muted">
          Пока выключены: {inactive.map((p) => p.fullName).join(", ")}. Их включит владелец, когда будет ясно имя аналитика и придёт время подключать CEO.
        </p>
      ) : null}
    </>
  );
}
