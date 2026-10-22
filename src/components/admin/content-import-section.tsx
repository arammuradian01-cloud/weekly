"use client";

// Импорт наполнения (этап 67): владелец при личном входе в режиме управления загружает пакет с задачами, решениями,
// целями и связями задач с целями, собранный из истории проекта. Сначала предпросмотр: сколько добавится, обновится
// и пропустится, кого и каких команд нет в ресурсе. Потом загрузка по подтверждению. Загрузка ничего не удаляет,
// повторная загрузка того же пакета ничего не дублирует

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrototype } from "@/domain/store";
import { Button } from "@/components/ui/button";
import { FileField } from "@/components/ui/file-field";
import { FormError } from "@/components/ui/field";
import { plural } from "@/domain/dates";
import { PACKAGE_MAX_BYTES } from "@/lib/content-import/limits";

type Counts = { add: number; update: number; skip: number };
type Preview = {
  title: string | null;
  tasks: Counts;
  decisions: Counts;
  goals: Counts;
  links: Counts;
  missingPeople: string[];
  missingTeams: string[];
  notes: { what: string; text: string }[];
  notified: number;
};
type Applied = Preview & { applied: { tasks: number[]; goals: number; decisions: number; links: number } };
type Answer<T> = { ok: true; value: T } | { ok: false; error: string; problems?: string[] };

async function post<T>(mode: "preview" | "apply", file: File): Promise<Answer<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/content-import?mode=${mode}`, { method: "POST", body: await file.text(), headers: { "Content-Type": "application/json" } });
  } catch {
    return { ok: false, error: "Нет связи с сервером: пакет не отправился" };
  }
  try {
    return (await res.json()) as Answer<T>;
  } catch {
    return { ok: false, error: res.status === 401 ? "Вход больше не действует: войдите заново" : "Не получилось прочитать ответ сервера. Обновите страницу и попробуйте ещё раз" };
  }
}

const KINDS: { key: "tasks" | "decisions" | "goals" | "links"; label: string }[] = [
  { key: "tasks", label: "Задачи" },
  { key: "decisions", label: "Решения" },
  { key: "goals", label: "Цели" },
  { key: "links", label: "Связи задач с целями" },
];

function line(c: Counts): string {
  return `добавится ${c.add}, обновится ${c.update}, пропустится ${c.skip}`;
}

export function ContentImportSection() {
  const headingId = useId();
  const router = useRouter();
  const { notify } = usePrototype();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Applied | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [problems, setProblems] = useState<string[]>([]);
  // Новый круг поля файла после «Отменить»: тот же файл можно выбрать снова
  const [round, setRound] = useState(0);

  const reset = () => {
    setPreview(null);
    setDone(null);
    setError(undefined);
    setProblems([]);
  };

  const check = async (f: File | null) => {
    setFile(f);
    reset();
    if (!f) return;
    if (f.size > PACKAGE_MAX_BYTES) {
      setError("Файл пакета больше 2 МБ: разделите его на части");
      return;
    }
    setBusy("preview");
    const r = await post<Preview>("preview", f);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      setProblems(r.problems ?? []);
      return;
    }
    setPreview(r.value);
  };

  const apply = async () => {
    if (!file) return;
    setBusy("apply");
    setError(undefined);
    const r = await post<Applied>("apply", file);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      setProblems(r.problems ?? []);
      return;
    }
    setPreview(null);
    setDone(r.value);
    const n = r.value.applied.tasks.length;
    notify(`Наполнение загружено: ${n} ${plural(n, "новая задача", "новые задачи", "новых задач")}, решений ${r.value.applied.decisions}, целей ${r.value.applied.goals}, связей ${r.value.applied.links}`);
    router.refresh();
  };

  const shown = done ?? preview;
  const nothing = preview && KINDS.every((k) => preview[k.key].add + preview[k.key].update === 0);

  return (
    <section id="content-import" aria-labelledby={headingId} className="sv-toc-section border-t border-line py-8" data-testid="content-import">
      <div className="max-w-[72ch]">
        <h2 id={headingId} className="text-title font-semibold text-ink">
          Импорт наполнения
        </h2>
        <p className="mt-1 text-small text-muted">
          Пакет с задачами, решениями, целями и связями задач с целями, собранный из истории проекта. Сначала ресурс покажет, что добавится, обновится и пропустится. Загрузка
          ничего не удаляет, поля, которые поменяли в ресурсе, не трогает, повторная загрузка того же пакета ничего не дублирует. Файл пакета храните у себя, в общие папки не
          кладите.
        </p>
      </div>
      <div className="mt-5 flex max-w-2xl flex-col gap-4">
        <FileField key={round} id="content-import-file" label="Файл пакета" accept=".json,application/json" fileName={file?.name ?? null} hint="JSON до 2 МБ" onChange={(f) => void check(f)} />
        {busy === "preview" ? (
          <p className="text-small text-muted" role="status">
            Проверяем пакет
          </p>
        ) : null}
        <FormError message={error} />
        {problems.length ? (
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-small text-danger-ink" data-testid="content-import-problems">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        ) : null}

        {shown ? (
          <div className="flex flex-col gap-4 rounded-xl bg-field p-4" data-testid={done ? "content-import-done" : "content-import-preview"} role="status">
            <p className="text-body font-semibold text-ink">{done ? "Загружено" : `Что даст загрузка${shown.title ? `: ${shown.title}` : ""}`}</p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-body text-ink">
              {KINDS.map((k) => (
                <li key={k.key} data-testid={`content-import-${k.key}`}>
                  <span className="font-medium">{k.label}:</span> {line(shown[k.key])}
                </li>
              ))}
            </ul>
            {done && done.applied.tasks.length ? (
              <p className="text-small text-muted">
                Номера новых задач: {done.applied.tasks.length > 12 ? `${done.applied.tasks.slice(0, 12).join(", ")} и ещё ${done.applied.tasks.length - 12}` : done.applied.tasks.join(", ")}
              </p>
            ) : null}
            {shown.missingPeople.length ? (
              <p className="text-small text-ink" data-testid="content-import-missing-people">
                <span className="font-medium">Нет в ресурсе:</span> {shown.missingPeople.join(", ")}. Их записи пропустятся, пока людей не добавят в «Людях и ролях».
              </p>
            ) : null}
            {shown.missingTeams.length ? (
              <p className="text-small text-ink" data-testid="content-import-missing-teams">
                <span className="font-medium">Нет команд:</span> {shown.missingTeams.join(", ")}.
              </p>
            ) : null}
            {!done && shown.notified ? (
              <p className="text-small text-muted">
                {shown.notified} {plural(shown.notified, "человек узнает", "человека узнают", "человек узнают")} о новых открытых задачах в «Мне». О закрытых задачах из истории
                событий не будет.
              </p>
            ) : null}
            {shown.notes.length ? (
              <details className="text-small text-ink">
                <summary className="cursor-pointer font-medium">Подробнее: что пропустится и почему ({shown.notes.length})</summary>
                <ul className="m-0 mt-2 flex list-disc flex-col gap-1 pl-5" data-testid="content-import-notes">
                  {shown.notes.map((n, i) => (
                    <li key={i}>
                      {n.what}: {n.text}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {!done ? (
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void apply()} disabled={!!busy || !!nothing} data-testid="content-import-apply">
                  {busy === "apply" ? "Загружаем" : nothing ? "Нечего загружать" : "Загрузить"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!!busy}
                  onClick={() => {
                    setFile(null);
                    setRound((r) => r + 1);
                    reset();
                  }}
                >
                  Отменить
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
