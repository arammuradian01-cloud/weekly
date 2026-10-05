"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipboardCopy, RefreshCw } from "lucide-react";
import { usePrototype } from "@/prototype/store";
import { personOf } from "@/prototype/people";
import type { WeeklyEntry } from "@/prototype/types";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/primitives";

type Sections = { main: string; risks: string; next: string };

/** Длинное тире в отчёте заменяется на дефис автоматически (раздел 3 ТЗ) */
function clean(text: string): string {
  return text.replace(/[—–]/g, "-");
}

function line(e: WeeklyEntry): string {
  const who = personOf(e.author).shortName;
  return `- ${e.what}${e.impact ? `. ${e.impact.replace(/\.$/, "")}` : ""} (${who})`;
}

function build(entries: WeeklyEntry[]): Sections {
  const flagged = entries.filter((e) => e.ceo);
  return {
    main: flagged.filter((e) => e.type === "result" || e.type === "event").map(line).join("\n"),
    risks: flagged.filter((e) => e.type === "risk").map(line).join("\n"),
    next: flagged
      .filter((e) => e.next || e.type === "plan")
      .map((e) => `- ${e.next ?? e.what} (${personOf(e.author).shortName})`)
      .join("\n"),
  };
}

export function CeoReport() {
  const { data, notify } = usePrototype();
  const week = data.reportingWeek;
  const entries = data.entries.filter((e) => e.week === week);
  const flaggedCount = entries.filter((e) => e.ceo).length;
  const [sections, setSections] = useState<Sections>(() => build(entries));
  const set = (key: keyof Sections, value: string) => setSections((s) => ({ ...s, [key]: clean(value) }));

  const fullText = [
    `Отчёт за неделю ${week}`,
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
      notify("Не получилось скопировать: выделите текст вручную");
    }
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-3 rounded-xl bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[15px] text-ink">
            Собрано из {flaggedCount} записей с отметкой «В отчёт CEO». Отметки ставятся в{" "}
            <Link href="/weekly" className="font-medium text-blue-700 hover:underline">
              ленте weekly
            </Link>
            .
          </p>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={() => setSections(build(entries))}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Собрать заново
            </Button>
            <Button size="sm" onClick={copy}>
              <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
              Скопировать текст
            </Button>
          </div>
        </div>

        <section aria-labelledby="ceo-numbers" className="rounded-xl border border-dashed border-line px-5 py-4">
          <h2 id="ceo-numbers" className="text-[17px] font-semibold text-ink">Цифры недели</h2>
          <p className="mt-1 text-[15px] text-muted">Появятся после подключения недельного отчёта (этап 10). Руками факт никто не вводит.</p>
        </section>

        <TextArea label="Главное за неделю" id="ceo-main" value={sections.main} onChange={(e) => set("main", e.target.value)} rows={6} hint="Пишите от первого лица, длинное тире заменяется на дефис само" />
        <TextArea label="Риски" id="ceo-risks" value={sections.risks} onChange={(e) => set("risks", e.target.value)} rows={4} />
        <TextArea label="Что дальше" id="ceo-next" value={sections.next} onChange={(e) => set("next", e.target.value)} rows={4} />
      </div>

      <aside aria-labelledby="ceo-history">
        <h2 id="ceo-history" className="mb-3 text-[17px] font-semibold text-ink">История отчётов</h2>
        <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
          <li className="px-4 py-3">
            <p className="text-[15px] font-medium text-ink">Неделя {week}</p>
            <p className="text-[13px] text-muted">Черновик, правите сейчас</p>
          </li>
          {[1, 2].map((d) => (
            <li key={d} className="px-4 py-3">
              <p className="text-[15px] font-medium text-ink">Неделя {week - d}</p>
              <p className="text-[13px] text-muted">Собран, правил Арам</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[13px] text-muted">Отчёт видят только владелец и администраторы. В Google-таблицу он не выгружается.</p>
      </aside>
    </div>
  );
}
