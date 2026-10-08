"use client";

// Шкала готовности крупных инициатив (этап 30). Две колонки: «Ещё ищем, как сделать» и «Уже делаем». На карточке
// ответственный, одна фраза о том, что сейчас происходит, и сколько инициатива в этом делении. Долго ищем или давно без
// новостей: метка словами, такие инициативы сами встают в повестку встречи команды ответственного.

import { useEffect, useId, useState } from "react";
import { Plus } from "lucide-react";
import type { InitiativeView, InitiativesPage } from "@/lib/initiatives/service";
import { NOTE_MAX, NOTE_PROMPTS, RESULT_LABELS, STATE_LABELS, TITLE_MAX, WHY_MAX, weeksText, type ResultCode, type StateCode } from "@/lib/initiatives/rules";
import {
  closeInitiativeAction,
  createInitiativeAction,
  editInitiativeAction,
  initiativeNoteAction,
  reopenInitiativeAction,
  setInitiativeStateAction,
} from "@/app/(app)/initiatives/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/overlays";
import { markSeenAction } from "@/app/(app)/me/actions";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { cn } from "@/lib/cn";

const when = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long" }).format(new Date(iso));
/** Фраза с точкой в конце, без двойной: «...в ноябре.» и «Почему?» остаются как есть */
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

type Dialog =
  | { kind: "state"; item: InitiativeView; to: StateCode }
  | { kind: "note"; item: InitiativeView }
  | { kind: "close"; item: InitiativeView }
  | { kind: "edit"; item: InitiativeView | null }
  | null;

const CHANGE_WORDS: Record<string, string> = {
  create: "Заведена",
  state: "Деление шкалы",
  note: "Заметка",
  owner: "Новый ответственный",
  edit: "Правка",
  close: "Закрыта",
  reopen: "Возвращена в работу",
};

export function InitiativesScreen({ data }: { data: InitiativesPage }) {
  const run = useRunAction();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const searching = data.active.filter((i) => i.state === "searching");
  const doing = data.active.filter((i) => i.state === "doing");
  const longSearch = data.active.filter((i) => i.flags.longSearch).length;
  const stale = data.active.filter((i) => i.flags.stale).length;

  // Переход по ссылке из «Мне» или повестки: карточка с якорем в поле зрения и подсвечена. Закрытая инициатива
  // лежит в свёрнутом списке: он раскрывается
  const [target, setTarget] = useState<string | null>(null);
  const [closedOpen, setClosedOpen] = useState(false);
  useEffect(() => {
    let hash = "";
    try {
      hash = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    if (!hash.startsWith("i-")) return;
    setTarget(hash);
    if (data.closed.some((i) => `i-${i.id}` === hash)) setClosedOpen(true);
    requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: "center" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Человек открыл страницу инициатив: события «Мне» о них прочитаны, письма о них уже не нужны
  const subjects = [...data.active, ...data.closed].map((i) => `initiative:${i.id}`).join("|");
  useEffect(() => {
    if (subjects) markSeenAction(subjects.split("|")).catch(() => undefined);
  }, [subjects]);

  const exec = async (fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, ok: string) => {
    setBusy(true);
    const result = await run(fn as never, ok);
    setBusy(false);
    if (result !== null) setDialog(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-body text-ink" aria-live="polite">
          {data.active.length ? (
            <>
              Уже делаем {doing.length}, ещё ищем, как сделать, {searching.length}.
              {longSearch ? ` Долго ищут: ${longSearch}.` : ""}
              {stale ? ` Без новостей больше двух недель: ${stale}.` : ""}
            </>
          ) : (
            "Крупных инициатив пока нет."
          )}
        </p>
        {data.canManage ? (
          <Button size="sm" className="shrink-0 self-start" onClick={() => setDialog({ kind: "edit", item: null })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Новая инициатива
          </Button>
        ) : null}
      </div>
      {data.active.length > data.softMax ? (
        <p className="text-small text-warning-ink">
          Открытых инициатив {data.active.length}, а шкала задумана для {data.softMax} самых крупных. Мелкие удобнее вести задачами.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {(["searching", "doing"] as const).map((state) => {
          const list = state === "searching" ? searching : doing;
          return (
            <section key={state} aria-labelledby={`col-${state}`} className="flex min-w-0 flex-col gap-3">
              <h2 id={`col-${state}`} className="text-title font-semibold text-ink">
                {STATE_LABELS[state]} <span className="text-muted">{list.length}</span>
              </h2>
              {list.length ? (
                <ul className="flex flex-col gap-3">
                  {list.map((i) => (
                    <li key={i.id}>
                      <Card item={i} highlighted={target === `i-${i.id}`} canManage={data.canManage} busy={busy} onDialog={setDialog} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-muted">{state === "searching" ? "Все инициативы уже в работе." : "Пока ни одна инициатива не перешла в работу."}</p>
              )}
            </section>
          );
        })}
      </div>

      {data.closed.length ? (
        <details className="sv-card sv-card--soft px-5 py-4" open={closedOpen} onToggle={(e) => setClosedOpen(e.currentTarget.open)}>
          <summary className="cursor-pointer text-body font-semibold text-ink">Закрытые инициативы ({data.closed.length})</summary>
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {data.closed.map((i) => (
              <li
                key={i.id}
                id={`i-${i.id}`}
                className={cn("flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between", target === `i-${i.id}` && "rounded-control outline outline-2 outline-offset-2 outline-[var(--color-focus)]")}
              >
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="text-body font-medium text-ink">{i.title}</p>
                  <p className="text-small text-muted">
                    {i.result ? RESULT_LABELS[i.result] : ""} {i.closedAt ? when(i.closedAt) : ""}
                    {i.resultNote ? `: ${sentence(i.resultNote)}` : "."} Ответственный: {i.owner.fullName}
                  </p>
                </div>
                {data.canManage ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0 self-start"
                    aria-label={`Вернуть в работу: ${i.title}`}
                    disabled={busy}
                    onClick={() => void exec(() => reopenInitiativeAction(i.id), "Инициатива снова в работе")}
                  >
                    Вернуть
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {dialog?.kind === "state" || dialog?.kind === "note" ? (
        <NoteDialog
          key={`${dialog.kind}-${dialog.item.id}`}
          dialog={dialog}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(text) =>
            dialog.kind === "state"
              ? exec(() => setInitiativeStateAction(dialog.item.id, dialog.to, text), dialog.to === "doing" ? "Инициатива в работе" : "Инициатива снова в поиске")
              : exec(() => initiativeNoteAction(dialog.item.id, text), "Заметка обновлена")
          }
        />
      ) : null}
      {dialog?.kind === "close" ? (
        <CloseDialog key={`close-${dialog.item.id}`} item={dialog.item} busy={busy} onClose={() => setDialog(null)} onSubmit={(result, text) => exec(() => closeInitiativeAction(dialog.item.id, result, text), "Инициатива закрыта")} />
      ) : null}
      {dialog?.kind === "edit" ? (
        <EditDialog
          key={`edit-${dialog.item?.id ?? "new"}`}
          item={dialog.item}
          data={data}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(form) => (dialog.item ? exec(() => editInitiativeAction(dialog.item!.id, form), "Инициатива сохранена") : exec(() => createInitiativeAction(form), "Инициатива заведена"))}
        />
      ) : null}
    </div>
  );
}

function Card({ item, highlighted, canManage, busy, onDialog }: { item: InitiativeView; highlighted: boolean; canManage: boolean; busy: boolean; onDialog: (d: Dialog) => void }) {
  const id = useId();
  const other: StateCode = item.state === "searching" ? "doing" : "searching";
  return (
    <article
      id={`i-${item.id}`}
      aria-labelledby={`${id}-t`}
      className={cn("sv-card flex flex-col gap-3 p-4 [overflow-wrap:anywhere]", highlighted && "outline outline-2 outline-offset-2 outline-[var(--color-focus)]")}
    >
      <div className="flex flex-col gap-1">
        <h3 id={`${id}-t`} className="text-body font-semibold text-ink">
          {item.title}
        </h3>
        <p className="text-small text-muted">
          Отвечает {item.owner.fullName}
          {item.owner.active ? "" : " (выключен)"}
          {item.team.id !== "top" ? `, команда «${item.team.name}»` : ""}
          {item.goal ? `. Цель: ${item.goal.code ? `${item.goal.code}. ` : ""}${item.goal.title}` : ""}
        </p>
      </div>
      {item.why ? <p className="text-small text-ink">{item.why}</p> : null}
      <div className="flex flex-col gap-1">
        <p className="text-small text-muted">{NOTE_PROMPTS[item.state]}</p>
        <p className="text-body text-ink">{item.note || <span className="text-muted">Заметки пока нет</span>}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {item.state === "searching" ? (
          <Badge tone={item.flags.longSearch ? "yellow" : "gray"}>Ищем {weeksText(item.flags.searchDays)}</Badge>
        ) : (
          <Badge tone="green">Делаем с {when(item.stateSince)}</Badge>
        )}
        {item.flags.stale ? <Badge tone="yellow">Без новостей {item.flags.staleDays} дн.</Badge> : <span className="text-caption text-muted">Обновлено {when(item.noteAt)}</span>}
      </div>
      {item.canUpdate ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={other === "doing" ? "primary" : "secondary"}
            aria-label={`${other === "doing" ? "Уже делаем" : "Вернуть в поиск"}: ${item.title}`}
            disabled={busy}
            onClick={() => onDialog({ kind: "state", item, to: other })}
          >
            {other === "doing" ? "Уже делаем" : "Вернуть в поиск"}
          </Button>
          <Button size="sm" variant="secondary" aria-label={`Обновить заметку: ${item.title}`} disabled={busy} onClick={() => onDialog({ kind: "note", item })}>
            Обновить заметку
          </Button>
          {canManage ? (
            <>
              <Button size="sm" variant="ghost" aria-label={`Править: ${item.title}`} disabled={busy} onClick={() => onDialog({ kind: "edit", item })}>
                Править
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Закрыть: ${item.title}`} disabled={busy} onClick={() => onDialog({ kind: "close", item })}>
                Закрыть
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {item.history.length ? (
        <details>
          <summary className="cursor-pointer text-small font-medium text-link">История</summary>
          <ul className="mt-2 flex flex-col gap-1 text-small text-muted">
            {item.history.map((h, n) => (
              <li key={`${h.at}-${n}`}>
                {when(h.at)}. {h.kind === "state" && h.to ? STATE_LABELS[h.to] : (CHANGE_WORDS[h.kind] ?? "Изменение")}
                {h.note && h.kind !== "owner" ? `: ${h.note}` : h.kind === "owner" && h.note ? `. ${h.note}` : ""}
                {h.by ? ` (${h.by})` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

function NoteDialog({
  dialog,
  busy,
  onClose,
  onSubmit,
}: {
  dialog: { kind: "state"; item: InitiativeView; to: StateCode } | { kind: "note"; item: InitiativeView };
  busy: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const state = dialog.kind === "state" ? dialog.to : dialog.item.state;
  const [text, setText] = useState(dialog.kind === "note" ? dialog.item.note : "");
  const id = useId();
  const title = dialog.kind === "state" ? (dialog.to === "doing" ? "Инициатива в работе" : "Вернуть в поиск") : "Обновить заметку";
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} description={dialog.item.title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onSubmit(text);
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-n`} className="sv-label">
            {NOTE_PROMPTS[state]}
          </label>
          <textarea id={`${id}-n`} className="sv-control" rows={3} maxLength={NOTE_MAX} value={text} onChange={(e) => setText(e.target.value)} required autoFocus />
          <p className="text-caption text-muted">Одна фраза, её видят все на странице инициатив и на встрече</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy || !text.trim()}>
            {dialog.kind === "state" ? (dialog.to === "doing" ? "Отметить «Уже делаем»" : "Вернуть в поиск") : "Сохранить"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CloseDialog({ item, busy, onClose, onSubmit }: { item: InitiativeView; busy: boolean; onClose: () => void; onSubmit: (result: ResultCode, text: string) => void }) {
  const [result, setResult] = useState<ResultCode | null>(null);
  const [text, setText] = useState("");
  const id = useId();
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Закрыть инициативу" description={item.title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (result && text.trim()) onSubmit(result, text);
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="sv-label mb-1">Чем закончилась</legend>
          {(["done", "dropped"] as const).map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 text-body text-ink">
              <input type="radio" name={`${id}-r`} value={r} checked={result === r} onChange={() => setResult(r)} className="h-4 w-4 accent-blue-700" />
              {RESULT_LABELS[r]}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-n`} className="sv-label">
            Итог одной фразой
          </label>
          <textarea id={`${id}-n`} className="sv-control" rows={2} maxLength={NOTE_MAX} value={text} onChange={(e) => setText(e.target.value)} required />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy || !result || !text.trim()}>
            Закрыть инициативу
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type Form = { title: string; why: string; owner: string; team: string; goal: string; note: string };

function EditDialog({ item, data, busy, onClose, onSubmit }: { item: InitiativeView | null; data: InitiativesPage; busy: boolean; onClose: () => void; onSubmit: (form: Form) => void }) {
  const [form, setForm] = useState<Form>({
    title: item?.title ?? "",
    why: item?.why ?? "",
    owner: item?.owner.slug ?? "",
    team: item?.team.id ?? "top",
    goal: item?.goal?.id ?? "",
    note: "",
  });
  const id = useId();
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  // Цель из прошлого квартала в списке не показывается, но у инициативы остаётся
  const goals = item?.goal && !data.goals.some((g) => g.id === item.goal!.id) ? [{ id: item.goal.id, label: `${item.goal.code ? `${item.goal.code}. ` : ""}${item.goal.title}` }, ...data.goals] : data.goals;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={item ? "Править инициативу" : "Новая инициатива"}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.title.trim() && form.owner) onSubmit(form);
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-t`} className="sv-label">
            Инициатива
          </label>
          <input id={`${id}-t`} className="sv-control" maxLength={TITLE_MAX} value={form.title} onChange={set("title")} required autoFocus />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-w`} className="sv-label">
            Зачем
          </label>
          <textarea id={`${id}-w`} className="sv-control" rows={2} maxLength={WHY_MAX} value={form.why} onChange={set("why")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-o`} className="sv-label">
              Ответственный
            </label>
            <select id={`${id}-o`} className="sv-control" value={form.owner} onChange={set("owner")} required>
              <option value="">Выберите</option>
              {data.people.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-c`} className="sv-label">
              Команда
            </label>
            <select id={`${id}-c`} className="sv-control" value={form.team} onChange={set("team")}>
              {data.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-g`} className="sv-label">
            Цель квартала
          </label>
          <select id={`${id}-g`} className="sv-control" value={form.goal} onChange={set("goal")}>
            <option value="">Без цели</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        {item ? null : (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-n`} className="sv-label">
              {NOTE_PROMPTS.searching}
            </label>
            <textarea id={`${id}-n`} className="sv-control" rows={2} maxLength={NOTE_MAX} value={form.note} onChange={set("note")} />
            <p className="text-caption text-muted">Можно оставить пустым: ответственный напишет сам. Новая инициатива начинается с деления «Ещё ищем, как сделать»</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy || !form.title.trim() || !form.owner}>
            {item ? "Сохранить" : "Завести инициативу"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </form>
    </Modal>
  );
}
