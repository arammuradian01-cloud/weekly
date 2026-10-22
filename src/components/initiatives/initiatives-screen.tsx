"use client";

// Шкала готовности крупных инициатив (этап 30). Две колонки: «Ещё ищем, как сделать» и «Уже делаем». На карточке
// ответственный, одна фраза о том, что сейчас происходит, и сколько инициатива в этом делении. Долго ищем или давно без
// новостей: метка словами, такие инициативы сами встают в повестку встречи команды ответственного.
// Этап 67г: инициативы видят все и делятся по департаментам (заголовок раздела), внутри по продуктам; у каждого
// продукта свои две колонки. Общие для департамента (без продукта) идут первыми, дальше продукты по порядку справочника.
// Этап 68в (третий пакет дизайнера): сверху путь инициативы тремя шагами (ищем, делаем, закрыто) и что встаёт в повестку
// встречи. Колонки «ищем» и «делаем» внутри каждого продукта строками: цветная полоса слева (красная у того, что в
// повестке), название, кто и где, заметка в две строки, срок в статусе, действия одной строкой; «зачем» и история под
// «История и подробности». Текст на цветной подложке цветом её тона: серый на ней в тёмной теме не держит 4,5:1.

import { TOP_TEAM, teamName } from "@/domain/teams";
import { useEffect, useId, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
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

/** Без продукта: инициатива общая для департамента */
const GENERAL = "Общие для департамента";
const NO_DEPARTMENT = "Департамент не указан";

type Group = { id: string; name: string; products: { code: string; label: string; items: InitiativeView[] }[] };

/** Открытые инициативы по департаментам, внутри по продуктам: общие первыми, дальше по порядку справочника */
function groupsOf(items: InitiativeView[], data: InitiativesPage): Group[] {
  const order = new Map(data.directions.map((d, i) => [d.code, i + 1]));
  const deps = new Map<string, Group>();
  for (const i of items) {
    const depId = i.department?.id ?? "";
    const dep = deps.get(depId) ?? { id: depId || "none", name: i.department?.name ?? NO_DEPARTMENT, products: [] };
    deps.set(depId, dep);
    const code = i.direction?.code ?? "";
    let product = dep.products.find((p) => p.code === code);
    if (!product) {
      product = { code, label: i.direction?.label ?? GENERAL, items: [] };
      dep.products.push(product);
    }
    product.items.push(i);
  }
  const list = [...deps.values()].sort((a, b) => (a.id === "none" ? 1 : b.id === "none" ? -1 : a.name.localeCompare(b.name, "ru")));
  for (const d of list) d.products.sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));
  return list;
}

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
      {/* Этап 68в: путь инициативы тремя шагами по порядку, под ним что встаёт в повестку встречи. Числа шагов те же, что
          были плитками (data-testid ini-fig-*): «долго ищут» и «без новостей» теперь списком повестки */}
      {data.active.length || data.closed.length ? (
        <section aria-label="Инициативы по этапам" className="sv-card flex flex-col gap-4 px-5 py-4">
          <ol aria-label="Инициативы в цифрах" className="m-0 grid list-none grid-cols-3 gap-2 p-0">
            {[
              { n: searching.length, label: "Ищем, как сделать", cls: "bg-warning-soft text-warning-ink", testId: "ini-fig-searching" },
              { n: doing.length, label: "Уже делаем", cls: "bg-green-soft text-green-ink", testId: "ini-fig-doing" },
              { n: data.closed.length, label: "Закрыто", cls: "bg-field text-text-secondary", testId: "ini-fig-closed" },
            ].map((f, k) => (
              <li key={f.testId} className={cn("relative flex min-w-0 flex-col rounded-control-lg px-3 py-3 sm:px-4", f.cls)} data-testid={f.testId}>
                <span className="text-title font-semibold tabular-nums leading-none">{f.n}</span>
                <span className="mt-1 text-small font-semibold [overflow-wrap:anywhere]">{f.label}</span>
                {/* Следующий шаг: значок между плитками, не текст */}
                {k < 2 ? <ChevronRight className="absolute -right-2.5 top-1/2 z-[1] hidden h-4 w-4 -translate-y-1/2 text-muted sm:block" aria-hidden="true" /> : null}
              </li>
            ))}
          </ol>
          {longSearch || stale ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-small" data-testid="ini-agenda">
              <span className="font-semibold text-danger-ink">В повестке встречи:</span>
              {data.active
                .filter((i) => i.flags.longSearch || i.flags.stale)
                .map((i) => (
                  // Метка переносится внутри себя: длинное название не раздвигает страницу на телефоне
                  <a key={i.id} href={`#i-${i.id}`} className="inline-block max-w-full rounded-control bg-field px-2 py-1 text-caption font-semibold text-ink [overflow-wrap:anywhere] hover:underline">
                    {i.title}
                    <span className="font-normal text-muted">, {i.flags.stale ? `без новостей ${i.flags.staleDays} дн.` : `ищем ${weeksText(i.flags.searchDays)}`}</span>
                  </a>
                ))}
              <span className="sr-only" data-testid="ini-fig-long">
                Долго ищут: {longSearch}
              </span>
              <span className="sr-only" data-testid="ini-fig-stale">
                Без новостей 2 недели: {stale}
              </span>
            </div>
          ) : null}
        </section>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-text-secondary" aria-live="polite">
          {data.active.length ? "Самые крупные дела по департаментам и продуктам" : "Крупных инициатив пока нет."}
        </p>
        {data.canManage ? (
          <Button size="sm" className="shrink-0" onClick={() => setDialog({ kind: "edit", item: null })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Новая инициатива
          </Button>
        ) : null}
      </div>
      {data.active.length > data.softMax ? (
        <p className="text-small text-warning-ink">
          Открытых {data.active.length} при задуманных {data.softMax}: мелкие удобнее вести задачами.
        </p>
      ) : null}

      {groupsOf(data.active, data).map((dep) => (
        <section key={dep.id} aria-labelledby={`dep-${dep.id}`} className="flex flex-col gap-4">
          <h2 id={`dep-${dep.id}`} className="text-title font-semibold text-ink">
            {dep.name}
          </h2>
          {dep.products.map((product) => {
            const group = `${dep.id}-${product.code || "general"}`;
            return (
              <section key={group} aria-labelledby={`prod-${group}`} className="flex flex-col gap-3" data-testid={`ini-product-${product.code || "general"}`}>
                <h3 id={`prod-${group}`} className="text-body font-semibold text-ink">
                  {product.label} <span className="font-normal text-muted">{product.items.length}</span>
                </h3>
                <StateColumns group={group} items={product.items} target={target} canManage={data.canManage} busy={busy} onDialog={setDialog} />
              </section>
            );
          })}
        </section>
      ))}

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

/** Две колонки шкалы для одного продукта: «Ещё ищем, как сделать» и «Уже делаем», строками с точкой цвета у заголовка */
function StateColumns({ group, items, target, canManage, busy, onDialog }: { group: string; items: InitiativeView[]; target: string | null; canManage: boolean; busy: boolean; onDialog: (d: Dialog) => void }) {
  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      {(["searching", "doing"] as const).map((state) => {
        const list = items.filter((i) => i.state === state);
        return (
          <section key={state} aria-labelledby={`col-${state}-${group}`} className="flex min-w-0 flex-col gap-2">
            <h4 id={`col-${state}-${group}`} className="m-0 flex items-center gap-2 text-small font-semibold text-ink">
              <span className={cn("h-2.5 w-2.5 rounded-full", state === "searching" ? "bg-warning" : "bg-green")} aria-hidden="true" />
              {STATE_LABELS[state]} <span className="font-normal text-muted">{list.length}</span>
            </h4>
            {list.length ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {list.map((i) => (
                  <li key={i.id}>
                    <Card item={i} highlighted={target === `i-${i.id}`} canManage={canManage} busy={busy} onDialog={onDialog} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sv-card sv-card--soft m-0 px-4 py-3 text-small text-text-secondary">{state === "searching" ? "Все инициативы продукта уже в работе." : "Пока ни одна инициатива продукта не перешла в работу."}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Card({ item, highlighted, canManage, busy, onDialog }: { item: InitiativeView; highlighted: boolean; canManage: boolean; busy: boolean; onDialog: (d: Dialog) => void }) {
  const id = useId();
  const other: StateCode = item.state === "searching" ? "doing" : "searching";
  // Встаёт в повестку встречи: долго ищем или давно без новостей. Полоса слева красная
  const alert = item.flags.longSearch || item.flags.stale;
  return (
    <article
      id={`i-${item.id}`}
      aria-labelledby={`${id}-t`}
      className={cn("sv-card relative flex flex-col gap-2.5 overflow-hidden py-3.5 pl-5 pr-4 [overflow-wrap:anywhere]", highlighted && "outline outline-2 outline-offset-2 outline-[var(--color-focus)]")}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", alert ? "bg-danger" : item.state === "searching" ? "bg-warning" : "bg-green")} aria-hidden="true" />
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          {/* Заголовок карточки на уровень ниже заголовка колонки (h4) */}
          <h5 id={`${id}-t`} className="m-0 text-body font-semibold leading-snug text-ink">
            {item.title}
          </h5>
          <p className="m-0 text-caption text-muted">
            {item.owner.fullName}
            {item.owner.active ? "" : " (выключен)"}
            {item.team.id !== "top" ? `, команда «${item.team.name}»${item.team.active ? "" : ` выключена, разбирается на встрече команды «${teamName(TOP_TEAM)}»`}` : ""}
            {item.goal ? `, цель ${item.goal.code ?? item.goal.title}` : ""}
          </p>
        </div>
        {item.state === "searching" ? (
          <Badge tone={item.flags.longSearch ? "yellow" : "gray"}>Ищем {weeksText(item.flags.searchDays)}</Badge>
        ) : (
          <Badge tone="green">Делаем с {when(item.stateSince)}</Badge>
        )}
      </div>
      {/* Заметка: что сейчас происходит, в две строки; целиком в подсказке. Вопрос к заметке, пока её нет */}
      <p className="m-0 line-clamp-2 text-small text-ink" title={item.note ?? NOTE_PROMPTS[item.state]}>
        {item.note ? item.note : <span className="text-muted">Заметки пока нет</span>}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={cn("text-caption", item.flags.stale ? "font-semibold text-danger-ink" : "text-muted")}>
          {item.flags.stale ? `Без новостей ${item.flags.staleDays} дн.` : `Обновлено ${when(item.noteAt)}`}
          {alert ? ", в повестке встречи" : ""}
        </span>
        {item.canUpdate ? (
          <div className="ml-auto flex flex-wrap gap-1.5">
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
              Заметка
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
      </div>
      {item.why || item.history.length ? (
        <details className="text-small">
          <summary className="cursor-pointer font-semibold text-link">История и подробности</summary>
          <div className="mt-2 flex flex-col gap-2">
            {item.why ? (
              <p className="m-0 text-text-secondary">
                <span className="font-semibold text-ink">Зачем: </span>
                {item.why}
              </p>
            ) : null}
            {item.history.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 border-l-2 border-line pl-3 text-muted">
                {item.history.map((h, n) => (
                  <li key={`${h.at}-${n}`}>
                    <span className="font-semibold text-text-secondary">{when(h.at)}.</span> {h.kind === "state" && h.to ? STATE_LABELS[h.to] : (CHANGE_WORDS[h.kind] ?? "Изменение")}
                    {h.note && h.kind !== "owner" ? `: ${h.note}` : h.kind === "owner" && h.note ? `. ${h.note}` : ""}
                    {h.by ? ` (${h.by})` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
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

type Form = { title: string; why: string; owner: string; team: string; goal: string; note: string; direction: string };

function EditDialog({ item, data, busy, onClose, onSubmit }: { item: InitiativeView | null; data: InitiativesPage; busy: boolean; onClose: () => void; onSubmit: (form: Form) => void }) {
  const [form, setForm] = useState<Form>({
    title: item?.title ?? "",
    why: item?.why ?? "",
    owner: item?.owner.slug ?? "",
    team: item?.team.id ?? "top",
    goal: item?.goal?.id ?? "",
    note: "",
    direction: item?.direction?.code ?? "",
  });
  const id = useId();
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  // Продукт выбран: ответственным встаёт руководитель направления, если ответственного ещё не выбирали руками
  // У правки ответственный уже выбран: продукт его не меняет. У новой, пока ответственного не выбирали руками
  const [ownerTouched, setOwnerTouched] = useState(!!item);
  const headOf = (code: string) => data.directions.find((d) => d.code === code)?.head ?? "";
  const setDirection = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const code = e.target.value;
    const head = headOf(code);
    setForm({ ...form, direction: code, owner: !ownerTouched && head && data.people.some((p) => p.slug === head) ? head : form.owner });
  };
  // Продукт, скрытый в справочнике, у правленой инициативы остаётся в списке
  const directions = item?.direction && !data.directions.some((d) => d.code === item.direction!.code) ? [...data.directions, { ...item.direction, head: null }] : data.directions;
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
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-p`} className="sv-label">
            Продукт
          </label>
          <select id={`${id}-p`} className="sv-control" value={form.direction} onChange={setDirection}>
            <option value="">{GENERAL}</option>
            {directions.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label}
              </option>
            ))}
          </select>
          <p className="text-caption text-muted">По продукту инициативы делятся на странице. Ответственным встанет руководитель направления, его можно поменять</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-o`} className="sv-label">
              Ответственный
            </label>
            <select
              id={`${id}-o`}
              className="sv-control"
              value={form.owner}
              onChange={(e) => {
                setOwnerTouched(true);
                set("owner")(e);
              }}
              required
            >
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
