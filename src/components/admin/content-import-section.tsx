"use client";

// Импорт наполнения (этап 67): владелец при личном входе в режиме управления загружает пакет с задачами, решениями,
// целями и связями задач с целями, собранный из истории проекта. Сначала предпросмотр: сколько добавится, обновится
// и пропустится, кого и каких команд нет в ресурсе, что не загрузится и почему, открытые задачи без актуального срока
// (одна дата на все, по умолчанию через две недели), вероятные дубли того, что уже есть в ресурсе (по умолчанию
// пропускаются, их можно включить по одному или все). Потом загрузка по подтверждению с теми же настройками. Загрузка
// стирает только решения, которые сама ставила и которые пакет перечислил для стирания, повторная загрузка того же пакета ничего не дублирует

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrototype } from "@/domain/store";
import { Button } from "@/components/ui/button";
import { FileField } from "@/components/ui/file-field";
import { FormError } from "@/components/ui/field";
import { TextInput } from "@/components/ui/primitives";
import { formatLong, plural, type IsoDate } from "@/domain/dates";
import { PACKAGE_MAX_BYTES, PACKAGE_MAX_LABEL } from "@/lib/content-import/limits";

type Counts = { add: number; update: number; skip: number };
type Preview = {
  title: string | null;
  tasks: Counts;
  decisions: Counts;
  goals: Counts;
  links: Counts;
  /** Крупные инициативы (этап 67г). Сервер до этапа 67г их не присылал */
  initiatives?: Counts;
  /** Weekly для CEO за прошедшие недели (этап 67г) */
  ceoReports?: Counts;
  /** Стирание решений, которые ставила загрузка (этап 67г) */
  removals?: { remove: number; skip: number };
  missingPeople: string[];
  missingTeams: string[];
  errors: Line[];
  warnings: Line[];
  /** Уже есть в ресурсе и совпадает с пакетом: загрузка только запомнит ключ */
  bound: Line[];
  duplicates: (Line & { id: string; on: boolean })[];
  withDuplicates: boolean;
  staleTasks: { key: string; title: string; due: IsoDate }[];
  staleDue: IsoDate;
  notes: Line[];
  notified: number;
};
type Line = { what: string; text: string };
/** Настройки загрузки: все дубли, выбранные дубли, срок для задач без актуального срока (null: по умолчанию) */
type Options = { all: boolean; picked: string[]; due: string | null };
const DEFAULTS: Options = { all: false, picked: [], due: null };
type Applied = Preview & { applied: { tasks: number[]; goals: number; decisions: number; links: number; initiatives?: number; removed?: number; ceoReports?: number } };
type Answer<T> = { ok: true; value: T } | { ok: false; error: string; problems?: string[] };

const SIGNED_OUT = "Вход больше не действует: войдите заново и загрузите пакет ещё раз";

/** Пакет уходит тем текстом, который был в предпросмотре: файл на диске могли поменять между шагами */
async function post<T>(mode: "preview" | "apply", text: string, o: Options): Promise<Answer<T>> {
  const query = new URLSearchParams({ mode });
  if (o.all) query.set("duplicates", "1");
  else if (o.picked.length) query.set("dup", o.picked.join(","));
  if (o.due) query.set("due", o.due);
  let res: Response;
  try {
    res = await fetch(`/api/content-import?${query.toString()}`, { method: "POST", body: text, headers: { "Content-Type": "application/json" }, redirect: "manual" });
  } catch {
    return { ok: false, error: "Нет связи с сервером: пакет не отправился" };
  }
  // Вход закончился: обработчик отвечает 401 текстом; перенаправление на вход тоже значит, что входа нет
  if (res.type === "opaqueredirect" || res.redirected) return { ok: false, error: SIGNED_OUT };
  try {
    return (await res.json()) as Answer<T>;
  } catch {
    return { ok: false, error: res.status === 401 ? SIGNED_OUT : "Не получилось прочитать ответ сервера. Обновите страницу и попробуйте ещё раз" };
  }
}

const KINDS: { key: "tasks" | "decisions" | "goals" | "links" | "initiatives" | "ceoReports"; label: string }[] = [
  { key: "tasks", label: "Задачи" },
  { key: "decisions", label: "Решения" },
  { key: "goals", label: "Цели" },
  { key: "links", label: "Связи задач с целями" },
  { key: "initiatives", label: "Крупные инициативы" },
  { key: "ceoReports", label: "Weekly для CEO по неделям" },
];

function line(c: Counts): string {
  return `добавится ${c.add}, обновится ${c.update}, пропустится ${c.skip}`;
}

function Lines({ items, testId }: { items: Line[]; testId: string }) {
  return (
    <ul className="m-0 mt-2 flex list-disc flex-col gap-1 pl-5" data-testid={testId}>
      {items.map((n, i) => (
        <li key={i}>
          {n.what}: {n.text}
        </li>
      ))}
    </ul>
  );
}

export function ContentImportSection() {
  const headingId = useId();
  const router = useRouter();
  const { notify } = usePrototype();
  const [file, setFile] = useState<File | null>(null);
  // Текст пакета, прочитанный при выборе файла: его же видит предпросмотр и получает загрузка
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Applied | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [problems, setProblems] = useState<string[]>([]);
  // Вероятные дубли по умолчанию пропускаются, владелец включает их по одному или все; срок для задач без актуального
  // срока по умолчанию выбирает сервер (через две недели)
  const [options, setOptions] = useState<Options>(DEFAULTS);
  // Новый круг поля файла после «Отменить»: тот же файл можно выбрать снова
  const [round, setRound] = useState(0);

  const reset = () => {
    setPreview(null);
    setDone(null);
    setError(undefined);
    setProblems([]);
  };

  // keep: пересчёт того же пакета (поменяли дубли или срок) по уже прочитанному тексту, прежний предпросмотр виден,
  // пока не придёт новый
  const check = async (f: File | null, o: Options = options, keep = false) => {
    setOptions(o);
    setFile(f);
    if (keep) {
      setError(undefined);
      setProblems([]);
    } else {
      setText(null);
      reset();
    }
    if (!f) return;
    if (f.size > PACKAGE_MAX_BYTES) {
      setError(`Файл пакета больше ${PACKAGE_MAX_LABEL}: разделите его на части`);
      return;
    }
    setBusy("preview");
    let body = keep ? text : null;
    if (body === null) {
      body = await f.text();
      setText(body);
    }
    const r = await post<Preview>("preview", body, o);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      setProblems(r.problems ?? []);
      return;
    }
    setPreview(r.value);
  };

  const apply = async () => {
    if (text === null) return;
    setBusy("apply");
    setError(undefined);
    const r = await post<Applied>("apply", text, options);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      setProblems(r.problems ?? []);
      return;
    }
    setPreview(null);
    setDone(r.value);
    setText(null);
    // Поле файла с чистого листа: тот же файл можно выбрать снова и увидеть, что загружать нечего
    setRound((x) => x + 1);
    const n = r.value.applied.tasks.length;
    notify(`Наполнение загружено: ${n} ${plural(n, "новая задача", "новые задачи", "новых задач")}, решений ${r.value.applied.decisions}, целей ${r.value.applied.goals}, связей ${r.value.applied.links}${r.value.applied.initiatives ? `, инициатив ${r.value.applied.initiatives}` : ""}${r.value.applied.ceoReports ? `, weekly для CEO ${r.value.applied.ceoReports}` : ""}${r.value.applied.removed ? `, стёрто решений ${r.value.applied.removed}` : ""}`);
    router.refresh();
  };

  const shown = done ?? preview;
  // Привязка к ресурсу тоже работа загрузки: при одних привязках кнопка «Загрузить» доступна
  const nothing = preview && KINDS.every((k) => (preview[k.key]?.add ?? 0) + (preview[k.key]?.update ?? 0) === 0) && !preview.bound.length && !preview.removals?.remove;

  return (
    <section id="content-import" aria-labelledby={headingId} className="sv-toc-section border-t border-line py-8" data-testid="content-import">
      <div className="max-w-[72ch]">
        <h2 id={headingId} className="text-title font-semibold text-ink">
          Импорт наполнения
        </h2>
        <p className="mt-1 text-small text-muted">
          Пакет с задачами, решениями, целями, связями задач с целями, крупными инициативами и weekly для CEO за прошедшие недели, собранный из истории проекта. Сначала ресурс покажет, что добавится, обновится и пропустится. Загрузка
          стирает только решения, которые сама ставила и которые пакет перечислил для стирания, поля, которые поменяли в ресурсе, не трогает, повторная загрузка того же пакета ничего не дублирует. Файл пакета храните у себя, в общие папки не
          кладите.
        </p>
      </div>
      <div className="mt-5 flex max-w-2xl flex-col gap-4">
        <FileField
          key={round}
          id="content-import-file"
          label="Файл пакета"
          accept=".json,application/json"
          fileName={file?.name ?? null}
          hint={`JSON до ${PACKAGE_MAX_LABEL}`}
          // Новый файл: настройки по умолчанию, дубли снова пропускаются, пока их не включить
          onChange={(f) => void check(f, DEFAULTS)}
        />
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
              {KINDS.filter((k) => {
                // Новые виды (инициативы, weekly для CEO) показываются, только если они есть в пакете
                const c = shown[k.key];
                return c && (k.key === "tasks" || k.key === "decisions" || k.key === "goals" || k.key === "links" || c.add + c.update + c.skip > 0);
              }).map((k) => (
                <li key={k.key} data-testid={`content-import-${k.key}`}>
                  <span className="font-medium">{k.label}:</span> {line(shown[k.key]!)}
                </li>
              ))}
              {shown.removals && shown.removals.remove + shown.removals.skip ? (
                <li data-testid="content-import-removals" className="text-danger-ink">
                  <span className="font-medium">Стереть решения, которые ставила загрузка:</span> {done ? "стёрто" : "сотрётся"} {shown.removals.remove}, пропустится {shown.removals.skip}. Стёртое не вернуть, текст останется в журнале
                </li>
              ) : null}
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
                {shown.notified} {plural(shown.notified, "человек узнает", "человека узнают", "человек узнают")} о новых открытых задачах на «Моей неделе»: ответственные, соисполнители и
                руководители, которые согласуют задачи своих людей. О закрытых задачах из истории событий не будет.
              </p>
            ) : null}
            {shown.errors.length ? (
              <div className="text-small text-danger-ink">
                <p className="font-medium">Не загрузятся, пока их не исправят в пакете ({shown.errors.length}):</p>
                <Lines items={shown.errors} testId="content-import-errors" />
              </div>
            ) : null}
            {shown.bound.length ? (
              <div className="text-small text-ink" data-testid="content-import-bound">
                <p className="font-medium">
                  {done ? "Привязано" : "Привяжется"} к ресурсу ({shown.bound.length}): {plural(shown.bound.length, "запись уже есть", "записи уже есть", "записей уже есть")} в
                  ресурсе, загрузка запоминает их ключи и ничего в них не меняет. Где поля в ресурсе отличаются от пакета, они перечислены.
                </p>
                <Lines items={shown.bound} testId="content-import-bound-list" />
              </div>
            ) : null}
            {shown.warnings.length ? (
              <div className="text-small text-ink">
                <p className="font-medium">Загрузятся не так, как в пакете ({shown.warnings.length}):</p>
                <Lines items={shown.warnings} testId="content-import-warnings" />
              </div>
            ) : null}
            {shown.staleTasks.length ? (
              <div className="flex flex-col gap-2 text-small text-ink" data-testid="content-import-stale">
                <p className="font-medium">
                  Задачи без актуального срока ({shown.staleTasks.length}): срок в пакете уже прошёл, а задача открыта. {done ? "Встали" : "Встанут"} со сроком{" "}
                  {formatLong(shown.staleDue)}, исходный срок из пакета сохранится.
                </p>
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5" data-testid="content-import-stale-list">
                  {shown.staleTasks.map((t) => (
                    <li key={t.key}>
                      «{t.title}», срок в пакете {formatLong(t.due)}
                    </li>
                  ))}
                </ul>
                {!done ? (
                  <TextInput
                    type="date"
                    id="content-import-stale-due"
                    label="Срок для задач без актуального срока"
                    hint="Одна дата на все такие задачи, по умолчанию через две недели. Поправить срок по одной можно потом в карточке задачи"
                    className="w-full max-w-[260px]"
                    value={options.due ?? shown.staleDue}
                    disabled={!!busy}
                    onChange={(e) => {
                      if (e.target.value) void check(file, { ...options, due: e.target.value }, true);
                    }}
                  />
                ) : null}
              </div>
            ) : null}
            {shown.duplicates.length ? (
              <div className="text-small text-ink">
                <p className="font-medium">Похоже на то, что уже есть в ресурсе ({shown.duplicates.length}). Отмеченные загрузятся, остальные пропустятся:</p>
                <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0" data-testid="content-import-duplicates">
                  {shown.duplicates.map((d) => (
                    <li key={d.id}>
                      <label className="flex min-h-9 items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0"
                          // Выбор виден сразу, не дожидаясь пересчёта предпросмотра: иначе отметка снимается обратно до ответа сервера
                          checked={done || options.all ? d.on : options.picked.includes(d.id)}
                          disabled={!!busy || !!done || options.all}
                          data-testid={`content-import-duplicate-${d.id}`}
                          onChange={(e) => void check(file, { ...options, picked: e.target.checked ? [...options.picked, d.id] : options.picked.filter((id) => id !== d.id) }, true)}
                        />
                        <span>
                          {d.what}: {d.text}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {!done ? (
                  <label className="mt-2 flex min-h-9 items-center gap-2 text-body text-ink">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={options.all}
                      disabled={!!busy}
                      data-testid="content-import-with-duplicates"
                      onChange={(e) => void check(file, { ...options, all: e.target.checked }, true)}
                    />
                    Загрузить все дубли
                  </label>
                ) : null}
              </div>
            ) : null}
            {shown.notes.length ? (
              <details className="text-small text-ink">
                <summary className="cursor-pointer font-medium">Подробнее: что пропустится и почему ({shown.notes.length})</summary>
                <Lines items={shown.notes} testId="content-import-notes" />
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
                    setText(null);
                    setRound((r) => r + 1);
                    setOptions(DEFAULTS);
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
