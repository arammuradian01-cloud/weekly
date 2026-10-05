"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipboardCopy, RefreshCw, Save } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { authorName } from "@/domain/people";
import { formatLong } from "@/domain/dates";
import type { WeekView } from "@/domain/types";
import { buildCeoSections, cleanDash, type CeoSections } from "@/lib/weekly/rules";
import type { CeoReportView } from "@/lib/weekly/service";
import { saveCeoReportAction } from "@/app/(app)/weekly/actions";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/primitives";
import { WeekSwitcher } from "@/components/weekly/weekly-feed";
import { useRunWeekly } from "@/components/weekly/use-weekly";

type History = { key: string; number: number; flagged: number; meeting: string; savedBy?: string; savedAt?: string }[];

const fromEntries = (view: WeekView) => buildCeoSections(view.entries, (slug) => authorName(slug, "short", "все лидеры"));

function moment(iso: string): string {
  const at = new Date(iso);
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(at);
}

/** Черновик отчёта CEO (раздел 3 ТЗ): видят только владелец и администраторы, в таблицу он не выгружается */
export function CeoReport({ view, saved, history }: { view: WeekView; saved: CeoReportView; history: History }) {
  const { notify } = usePrototype();
  const run = useRunWeekly();
  const week = view.week;
  const flaggedCount = view.entries.filter((e) => e.ceo).length;
  const [sections, setSections] = useState<CeoSections>(() => saved.sections ?? fromEntries(view));
  const [dirty, setDirty] = useState(!saved.sections);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof CeoSections, value: string) => {
    setSections((s) => ({ ...s, [key]: cleanDash(value) }));
    setDirty(true);
  };

  const fullText = [
    `Отчёт за неделю ${week.number}`,
    "",
    "Цифры недели",
    "Появятся после подключения недельного отчёта.",
    "",
    "Главное за неделю",
    sections.main || "-",
    "",
    "Риски",
    sections.risks || "-",
    "",
    "Что дальше",
    sections.next || "-",
  ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      notify("Текст отчёта скопирован");
    } catch {
      notify("Не получилось скопировать: выделите текст вручную", "error");
    }
  };

  const save = async () => {
    setBusy(true);
    const result = await run(() => saveCeoReportAction(week.key, sections), `Отчёт за неделю ${week.number} сохранён`);
    setBusy(false);
    if (result) setDirty(false);
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <WeekSwitcher view={view} basePath="/ceo-report" />
          <p className="text-[14px] text-muted" aria-live="polite">
            {dirty ? "Есть несохранённые правки" : saved.updatedAt ? `Сохранён ${moment(saved.updatedAt)}${saved.updatedBy ? `, ${saved.updatedBy}` : ""}` : ""}
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-xl bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[15px] text-ink">
            {flaggedCount ? `Записей с отметкой «В отчёт CEO»: ${flaggedCount}.` : "Отметок «В отчёт CEO» за эту неделю нет."} Отметки ставятся в{" "}
            <Link href={`/weekly?week=${week.key}`} className="font-medium text-blue-700 hover:underline">
              ленте weekly
            </Link>
            .
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setSections(fromEntries(view));
                setDirty(true);
              }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Собрать заново
            </Button>
            <Button size="sm" variant="secondary" onClick={copy}>
              <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
              Скопировать текст
            </Button>
            <Button size="sm" onClick={save} disabled={busy || !dirty}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {busy ? "Сохраняю…" : "Сохранить"}
            </Button>
          </div>
        </div>

        <section aria-labelledby="ceo-numbers" className="rounded-xl border border-dashed border-line px-5 py-4">
          <h2 id="ceo-numbers" className="text-[17px] font-semibold text-ink">Цифры недели</h2>
          <p className="mt-1 text-[15px] text-muted">Появятся после подключения недельного отчёта (этап 10). Руками факт никто не вводит.</p>
        </section>

        <TextArea label="Главное за неделю" id="ceo-main" value={sections.main} onChange={(e) => set("main", e.target.value)} rows={6} hint="Пишите от первого лица. Длинное тире и стрелки заменяются на дефис сами" />
        <TextArea label="Риски" id="ceo-risks" value={sections.risks} onChange={(e) => set("risks", e.target.value)} rows={4} />
        <TextArea label="Что дальше" id="ceo-next" value={sections.next} onChange={(e) => set("next", e.target.value)} rows={4} />
      </div>

      <aside aria-labelledby="ceo-history">
        <h2 id="ceo-history" className="mb-3 text-[17px] font-semibold text-ink">История отчётов</h2>
        {history.length === 0 ? (
          <p className="text-[14px] text-muted">Пока ни одного отчёта.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
            {history.map((h) => (
              <li key={h.key}>
                <Link href={`/ceo-report?week=${h.key}`} aria-current={h.key === week.key ? "page" : undefined} className="block px-4 py-3 hover:bg-surface aria-[current=page]:bg-surface">
                  <p className="text-[15px] font-medium text-ink">Неделя {h.number}</p>
                  <p className="text-[13px] text-muted">
                    {h.savedAt ? `Сохранён ${moment(h.savedAt)}${h.savedBy ? `, ${h.savedBy}` : ""}` : "Не сохранялся"}. Отметок: {h.flagged}, встреча {h.meeting}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[13px] text-muted">Отчёт видят только владелец и администраторы. В Google-таблицу он не выгружается. Встреча недели {week.number}: {formatLong(week.meetingDate)}.</p>
      </aside>
    </div>
  );
}
