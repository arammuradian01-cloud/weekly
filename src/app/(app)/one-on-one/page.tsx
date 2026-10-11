import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth";
import { currentActor } from "@/lib/action-runner";
import { listPairs, pairPath } from "@/lib/one-on-one/service";
import { personalLogin } from "@/lib/one-on-one/rules";
import { formatShort } from "@/domain/dates";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Figures } from "@/components/ui/data";

export const metadata: Metadata = { title: "Один на один" };

/** Встречи один на один (этап 28): с кем у человека встречи, когда следующая, сколько тем в повестке */
export default async function OneOnOnePage({ searchParams }: { searchParams: Promise<{ pair?: string }> }) {
  const ctx = await requireContext();
  const { pair } = await searchParams;
  const description = "Встречи руководителя и человека его команды: повестку ставит человек, незакрытые темы переходят на следующую встречу";
  const header = <PageHeader title="Один на один" description={description} />;
  if (!personalLogin(ctx.via)) {
    return (
      <>
        {header}
        <EmptyState title="Встречи один на один открываются только при личном входе">
          По общему логину их не видно: профиль в нём выбирают сами. Войдите под своим логином и паролем.
        </EmptyState>
      </>
    );
  }
  const actor = await currentActor();
  // Ссылка из «Мне» и уведомлений: по id пары открываем страницу собеседника
  if (pair) {
    const path = await pairPath(actor, pair);
    if (path) redirect(path);
  }
  const pairs = await listPairs(actor);
  const mine = pairs.filter((p) => p.role === "manager");
  const managers = pairs.filter((p) => p.role === "report");
  const row = (p: (typeof pairs)[number]) => (
    <li key={p.other.id}>
      <Link href={`/one-on-one/${p.other.slug}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-field sm:flex-row sm:items-center sm:justify-between">
        <span className="min-w-0">
          <span className="block text-body font-semibold text-ink">{p.other.fullName}</span>
          {p.other.position ? <span className="block text-small text-muted">{p.other.position}</span> : null}
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-small text-muted sm:justify-end">
          <span className={p.next ? "text-ink" : undefined}>{p.next ? `Следующая: ${formatShort(p.next)}` : "Встреча не назначена"}</span>
          <span>В повестке: {p.openTopics}</span>
          {p.lastDone ? <span>Прошлая: {formatShort(p.lastDone)}</span> : null}
        </span>
      </Link>
    </li>
  );
  return (
    <>
      <PageHeader
        title="Один на один"
        description={description}
        figures={
          pairs.length ? (
            // Этап 37: встречи в цифрах
            <Figures
              label="Встречи в цифрах"
              items={[
                { label: "Собеседников", value: pairs.length, testId: "oo-fig-pairs" },
                { label: "Следующая встреча назначена", value: pairs.filter((p) => p.next).length, testId: "oo-fig-next" },
                { label: "Без назначенной встречи", value: pairs.filter((p) => !p.next).length, tone: "warning", testId: "oo-fig-nonext" },
                { label: "Тем в повестке", value: pairs.reduce((s, p) => s + p.openTopics, 0), testId: "oo-fig-topics" },
              ]}
            />
          ) : null
        }
      />
      {pair ? <p className="mb-4 text-small text-muted">Ссылка ведёт на встречу, которой у вас нет. Ниже ваши встречи.</p> : null}
      {pairs.length ? (
        <div className="flex flex-col gap-8">
          {managers.length ? (
            <section aria-labelledby="oo-managers">
              <h2 id="oo-managers" className="text-title font-semibold text-ink">
                С руководителем
              </h2>
              <ul className="mt-3 flex flex-col divide-y divide-line sv-card sv-card--soft">{managers.map(row)}</ul>
            </section>
          ) : null}
          {mine.length ? (
            <section aria-labelledby="oo-people">
              <h2 id="oo-people" className="text-title font-semibold text-ink">
                С людьми команды <span className="font-normal text-muted">{mine.length}</span>
              </h2>
              <ul className="mt-3 flex flex-col divide-y divide-line sv-card sv-card--soft">{mine.map(row)}</ul>
            </section>
          ) : null}
          <p className="text-caption text-muted">Встречи видите только вы и собеседник. Режим управления их не открывает, в журнал содержимое не попадает.</p>
        </div>
      ) : (
        <EmptyState title="Встреч один на один пока нет">Они появятся, когда вы будете в команде с руководителем или у вас будут люди в команде.</EmptyState>
      )}
    </>
  );
}
