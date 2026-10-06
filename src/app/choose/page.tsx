import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireSignedIn } from "@/lib/auth";
import { chooseProfile } from "@/app/actions/auth";
import { ROLE_LABELS } from "@/lib/roles";
import { Wordmark } from "@/components/brand/wordmark";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Выберите себя" };
export const dynamic = "force-dynamic";

export default async function ChoosePage() {
  const session = await requireSignedIn();
  const people = await prisma.person.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="min-h-dvh bg-surface">
      <header className="flex h-16 items-center bg-navy px-6 sm:px-10">
        <Wordmark />
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-page font-semibold text-ink sm:text-page-lg">Выберите себя</h1>
        <p className="mt-1.5 max-w-2xl text-body text-muted">
          Выбор запомнится на этом устройстве на 30 дней, сменить его можно в меню профиля. От этого выбора зависит, чьи weekly и задачи вы ведёте.
        </p>

        <form action={chooseProfile} className="mt-8">
          <ul className="grid gap-3 sm:grid-cols-2">
            {people.map((p) => {
              const current = p.id === session.personId;
              return (
                <li key={p.id}>
                  <button
                    type="submit"
                    name="personId"
                    value={p.id}
                    className={cn(
                      "flex min-h-[76px] w-full items-center justify-between gap-4 rounded-xl bg-white px-5 py-4 text-left ring-1 transition-shadow hover:ring-2 hover:ring-blue",
                      current ? "ring-2 ring-blue" : "ring-line",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-title-sm font-semibold text-ink">{p.fullName}</span>
                      <span className="mt-0.5 block text-small text-muted">{p.zone}</span>
                    </span>
                    {p.role !== "LEADER" ? <Badge tone={p.role === "OWNER" ? "navy" : "outline"}>{ROLE_LABELS[p.role]}</Badge> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </form>
      </main>
    </div>
  );
}
