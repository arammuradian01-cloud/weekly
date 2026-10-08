"use client";

// Загрузка структуры из таблицы (этап 14): файл CSV или ячейки, вставленные из Google-таблицы.
// Сначала проверка: что добавится, изменится и уйдёт. База меняется только по кнопке «Загрузить».

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StructurePlan } from "@/lib/org/import";
import { usePrototype } from "@/domain/store";
import { Drawer } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/primitives";
import { applyStructureAction, previewStructureAction } from "@/app/(app)/structure/actions";

export function StructureImport({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<StructurePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { notify } = usePrototype();
  const router = useRouter();

  const check = (value: string) =>
    start(async () => {
      setError(null);
      const r = await previewStructureAction(value);
      if (r.ok) setPlan(r.value);
      else {
        setPlan(null);
        setError(r.error);
      }
    });

  const apply = () =>
    start(async () => {
      const r = await applyStructureAction(text);
      if (!r.ok) return setError(r.error);
      const v = r.value;
      notify(`Структура загружена: новых людей ${v.added}, изменено ${v.changed}, новых команд ${v.teams}`);
      onOpenChange(false);
      setPlan(null);
      setText("");
      router.refresh();
    });

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Загрузить структуру"
      description="Лист структуры из таблицы: файл CSV или ячейки, скопированные целиком вместе со строкой заголовков"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
          <Button variant="secondary" disabled={!text.trim() || pending} onClick={() => check(text)}>
            Проверить
          </Button>
          <Button disabled={!plan || plan.problems.length > 0 || pending} onClick={apply}>
            {pending ? "Подождите…" : "Загрузить"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="rounded-lg bg-field px-4 py-3 text-small text-ink">
          <p className="font-semibold">Какие колонки читаются</p>
          <p className="mt-1 text-muted">
            ФИО, Должность, Управление, Отдел, Сектор, Направление, Руководитель, Функциональный руководитель, Почта, Руководит (да, если человек руководит своим подразделением), Статус (вакансия).
            Остальные колонки, в том числе кадровые, ресурс не читает и не хранит.
          </p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Файл CSV</span>
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="text-small"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const value = await file.text();
              setText(value);
              check(value);
            }}
          />
        </label>
        <TextArea label="Или вставьте ячейки из таблицы" id="structure-paste" value={text} onChange={(e) => setText(e.target.value)} rows={6} hint="Выделите лист вместе со строкой заголовков, скопируйте и вставьте сюда" />
        {error ? (
          <p role="alert" className="sv-alert sv-alert--danger">
            {error}
          </p>
        ) : null}
        {plan ? <PlanView plan={plan} /> : null}
      </div>
    </Drawer>
  );
}

function PlanView({ plan }: { plan: StructurePlan }) {
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <p className="text-body text-ink">
        Людей добавится {plan.people.add.length}, изменится {plan.people.change.length}, без изменений {plan.people.same}. Подразделений новых {plan.units.add.length}, вакансий{" "}
        {plan.vacancies.length}.
      </p>
      {plan.problems.length ? (
        <Section title={`Исправьте в файле: ${plan.problems.length}`} tone="danger">
          {plan.problems.map((p, i) => (
            <li key={i}>
              Строка {p.line}: {p.text}
            </li>
          ))}
        </Section>
      ) : null}
      {plan.people.add.length ? (
        <Section title="Новые сотрудники">
          {plan.people.add.map((p) => (
            <li key={p.line}>
              {p.fullName}
              {p.position ? `, ${p.position}` : ""}
              {p.path.length ? `, ${p.path.at(-1)}` : ""}
            </li>
          ))}
        </Section>
      ) : null}
      {plan.people.change.length ? (
        <Section title="Изменится">
          {plan.people.change.map((p) => (
            <li key={p.line}>
              {p.fullName}: {p.changes.join("; ")}
            </li>
          ))}
        </Section>
      ) : null}
      {plan.units.add.length ? (
        <Section title="Новые подразделения">
          {plan.units.add.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </Section>
      ) : null}
      {plan.units.remove.length ? (
        <Section title="Подразделения выключатся: их нет в файле">
          {plan.units.remove.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </Section>
      ) : null}
      {plan.people.missing.length ? (
        <Section title="Были в структуре, а в файле их нет">
          <li className="list-none text-muted">Ресурс их не выключит: у них могут быть задачи. Выключить можно в «Людях и ролях».</li>
          {plan.people.missing.map((p) => (
            <li key={p.slug}>{p.fullName}</li>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone?: "danger"; children: React.ReactNode }) {
  return (
    <section className={tone === "danger" ? "rounded-lg bg-danger-soft px-4 py-3" : ""}>
      <h3 className={tone === "danger" ? "text-small font-semibold text-danger-ink" : "text-small font-semibold text-ink"}>{title}</h3>
      <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-5 text-small text-ink">{children}</ul>
    </section>
  );
}
