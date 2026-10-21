"use client";

import { useId, useState } from "react";
import { saveApprovalAction } from "@/app/(app)/settings/actions";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/primitives";
import { APPROVAL_MODE_LABELS, APPROVAL_MODES, type ApprovalMode, type ApprovalSetting } from "@/lib/tasks/approval-modes";

const OPTIONS = APPROVAL_MODES.map((m) => ({ value: m, label: APPROVAL_MODE_LABELS[m] }));

/**
 * Согласование задач в другие департаменты (этап 54): правило по умолчанию и отдельные правила департаментов.
 * Правило выбирается по департаменту ответственного: принимающая сторона решает, как к ней приходят задачи
 */
export function ApprovalSection({ setting, departments }: { setting: ApprovalSetting; departments: { id: string; name: string }[] }) {
  const headingId = useId();
  const run = useRunAction();
  const [def, setDef] = useState<ApprovalMode>(setting.default);
  const [deps, setDeps] = useState<Record<string, ApprovalMode | "">>(() => Object.fromEntries(departments.map((d) => [d.id, setting.departments[d.id] ?? ""])));
  const [busy, setBusy] = useState(false);
  return (
    <section id="approval" aria-labelledby={headingId} className="sv-toc-section border-t border-line py-8" data-testid="approval-section">
      <div className="max-w-[72ch]">
        <h2 id={headingId} className="text-title font-semibold text-ink">
          Согласование задач
        </h2>
        <p className="mt-1 text-small text-muted">
          Задача человеку из другого департамента. «Согласование»: задачу принимает его руководитель, сам человек ждёт. «Информировать»: задача ставится сразу, руководитель получает
          событие в «Мне». Руководитель по линии подчинения ставит своим людям без согласования. Правило берётся по департаменту того, кому ставят задачу.
        </p>
      </div>
      <form
        className="mt-5 flex max-w-2xl flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const departmentsOut = Object.fromEntries(Object.entries(deps).filter(([, m]) => m) as [string, ApprovalMode][]);
          await run(() => saveApprovalAction({ default: def, departments: departmentsOut }), "Согласование задач сохранено");
          setBusy(false);
        }}
      >
        <SelectField label="По умолчанию" id="approval-default" value={def} onChange={(e) => setDef(e.target.value as ApprovalMode)} options={OPTIONS} />
        {departments.length ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-body font-semibold text-ink">Департаменты</legend>
            {departments.map((d) => (
              <SelectField
                key={d.id}
                label={d.name}
                id={`approval-${d.id}`}
                value={deps[d.id] ?? ""}
                onChange={(e) => setDeps((s) => ({ ...s, [d.id]: e.target.value as ApprovalMode | "" }))}
                options={[{ value: "", label: `Как по умолчанию: ${APPROVAL_MODE_LABELS[def].toLowerCase()}` }, ...OPTIONS]}
              />
            ))}
          </fieldset>
        ) : (
          <p className="text-small text-muted">Департаменты появятся после загрузки структуры компании.</p>
        )}
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Сохраняем" : "Сохранить"}
          </Button>
        </div>
      </form>
    </section>
  );
}
