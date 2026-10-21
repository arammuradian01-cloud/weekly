"use client";

// Страница разбора встречи из Notion (этап 61): «Разбираем встречу…», пока сервер читает страницу и разбирает текст,
// потом вкладки. «Итоги»: главное, решения, риски, что дальше и (ведущим) текст страницы. «Weekly для CEO»: черновик по
// разделам отчёта CEO и предпросмотр собранного отчёта, «Отправить CEO» (только в приложении); наблюдателю и общему
// логину вкладки нет. «Задачи»: черновики задач и решения по одному, «Создать задачи» разом. Права проверяет сервер,
// экран только прячет кнопки и объясняет, почему их нет.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, Save, Send, Sparkles, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { compactName, personOf } from "@/domain/people";
import { dictOptions } from "@/domain/dictionaries";
import { formatLong, plural } from "@/domain/dates";
import type { PersonSlug } from "@/domain/types";
import type { CeoSections } from "@/lib/weekly/rules";
import { hasCeoText, mergeCeoSections, type CeoMergeMode, type ParseDecision, type ParseTaskDraft } from "@/lib/meeting/parse-types";
import type { ParseView } from "@/lib/meeting/parse-service";
import { createParseTasksAction, retryParseAction, saveParseDraftAction, sendParseToCeoAction } from "@/app/(app)/meeting/parse-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { Segmented, SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { FormError } from "@/components/ui/field";
import { PersonSelect } from "@/components/requests/request-parts";
import { CeoAssembled } from "@/components/ceo/ceo-assembled";
import { cn } from "@/lib/cn";

export type ParseTab = "summary" | "ceo" | "tasks";

const moment = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(" в ", ", ");

const personName = (slug: string) => personOf(slug as PersonSlug).fullName;

export function NotionParseScreen({ view, initialTab }: { view: ParseView; initialTab: ParseTab }) {
  return (
    <div className="flex flex-col gap-5">
      <Meta view={view} />
      {view.status === "pending" ? <Pending view={view} /> : view.status === "failed" ? <Failed view={view} /> : <Ready view={view} initialTab={initialTab} />}
    </div>
  );
}

function Meta({ view }: { view: ParseView }) {
  const tone = view.status === "failed" ? "red" : view.status === "pending" ? "blue" : view.ceoSentAt || view.tasksCreatedAt ? "green" : "gray";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-body text-muted">
        <Badge tone={tone} dot>
          {view.statusLabel}
        </Badge>
        <span>
          {view.team.name}, неделя {view.weekNumber}, встреча {formatLong(view.meetingDate)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small">
        <a href={view.notionUrl} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 font-medium text-blue-700 underline-offset-2 hover:underline">
          <span className="min-w-0 break-all">{view.title || "Страница в Notion"}</span>
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
        </a>
        <Link href={`/weekly/meeting?week=${view.week}`} className="font-medium text-blue-700 underline-offset-2 hover:underline">
          К встрече
        </Link>
        {view.createdBy ? <span className="text-muted">Запустил {view.createdBy}, {moment(view.createdAt)}</span> : null}
      </div>
    </div>
  );
}

function RetryButton({ id, label = "Повторить" }: { id: string; label?: string }) {
  const router = useRouter();
  const { notify } = usePrototype();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await retryParseAction(id);
          if (!r.ok) notify(r.error, "error");
          else router.refresh();
        } catch {
          notify("Нет связи с сервером", "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
      {busy ? "Запускаем…" : label}
    </Button>
  );
}

/**
 * Разбор идёт: страница сама обновляется раз в пару секунд, пока статус не сменится. Разбор давно не подавал признаков
 * жизни: экран предлагает повторить, но опрос продолжается реже, чтобы подхватить поздний результат. Озвучивается только
 * смена состояния, счётчик секунд вне живой области
 */
function Pending({ view }: { view: ParseView }) {
  const router = useRouter();
  const { stale, startedAt } = view;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const poll = setInterval(() => router.refresh(), stale ? 10_000 : 2500);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [stale, router]);
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  if (stale) {
    return (
      <div className="flex flex-col gap-3 sv-card sv-card--soft bg-warning-soft px-5 py-4" data-testid="parse-stale">
        <p role="status" className="font-medium text-warning-ink">
          Разбор давно не подаёт признаков жизни
        </p>
        <p className="text-body text-ink">Скорее всего, сервер перезапускался посреди разбора. Можно запустить разбор ещё раз; если результат всё же придёт, страница покажет его сама.</p>
        <p className="text-small text-muted" aria-hidden="true">
          С начала разбора {elapsed}
        </p>
        {view.canRetry ? (
          <div>
            <RetryButton id={view.id} />
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 sv-card sv-card--soft px-5 py-5" data-testid="parse-pending">
      <span className="sv-spinner mt-1 shrink-0" aria-hidden="true" />
      <div>
        <p role="status" className="text-title-sm font-semibold text-ink">
          Разбираем встречу…
        </p>
        <p className="mt-1 text-body text-muted">Читаем страницу Notion и разбираем текст: итоги, решения, черновик weekly для CEO и задачи. Обычно это занимает до минуты.</p>
        <p className="mt-1 text-small text-muted" aria-hidden="true">
          Идёт {elapsed}
        </p>
      </div>
    </div>
  );
}

function Failed({ view }: { view: ParseView }) {
  return (
    <div role="alert" className="flex flex-col gap-3 sv-card sv-card--soft bg-danger-soft px-5 py-4" data-testid="parse-failed">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-ink" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium text-danger-ink">Встречу не разобрали</p>
          <p className="mt-0.5 break-words text-body text-ink">{view.note ?? "Неизвестная ошибка"}</p>
        </div>
      </div>
      {view.canRetry ? (
        <div className="flex flex-wrap gap-2">
          <RetryButton id={view.id} />
          <Link href={`/weekly/meeting?week=${view.week}`} className="inline-flex h-11 items-center rounded-lg px-4 text-body font-semibold text-ink ring-1 ring-line hover:bg-field">
            Другая ссылка
          </Link>
        </div>
      ) : null}
    </div>
  );
}

type Busy = "save" | "send" | "tasks" | null;

/** Последняя открытая вкладка разбора: экран собирается заново по свежей версии с сервера и остаётся на ней */
const lastTab = new Map<string, ParseTab>();

function Ready({ view, initialTab }: { view: ParseView; initialTab: ParseTab }) {
  const router = useRouter();
  const { notify } = usePrototype();
  const tabs: { code: ParseTab; label: string }[] = [
    { code: "summary", label: "Итоги" },
    ...(view.canSeeCeo ? [{ code: "ceo" as const, label: "Weekly для CEO" }] : []),
    { code: "tasks", label: "Задачи" },
  ];
  // Вкладка из адреса на клиенте: после отправки или сохранения разбор обновляется и экран собирается заново, но
  // остаётся на той вкладке, где был человек, а не прыгает на «Итоги»
  const fromUrl = useSearchParams().get("tab");
  const [tab, setTab] = useState<ParseTab>(() => {
    const wanted = lastTab.get(view.id) ?? tabs.find((t) => t.code === fromUrl)?.code ?? initialTab;
    return tabs.some((t) => t.code === wanted) ? wanted : "summary";
  });
  const [ceo, setCeo] = useState<CeoSections>(view.result.ceo);
  const [tasks, setTasks] = useState<ParseTaskDraft[]>(view.result.tasks);
  const [decisions, setDecisions] = useState<ParseDecision[]>(view.result.decisions);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  // Версия разбора, которую видел экран: после частичного успеха (черновик сохранился, отправка CEO упала) повтор
  // идёт с новой версией и не упирается в «разбор уже поправили»
  const [version, setVersion] = useState(view.updatedAt);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const choose = (t: ParseTab, focus = false) => {
    setTab(t);
    lastTab.set(view.id, t);
    if (focus) tabRefs.current[t]?.focus();
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", t);
      window.history.replaceState(window.history.state, "", u.toString());
    } catch {
      // Адрес не обновился: вкладка всё равно открыта
    }
  };
  const editCeo = (patch: Partial<CeoSections>) => {
    setCeo((c) => ({ ...c, ...patch }));
    setDirty(true);
  };
  const editTask = (key: string, patch: Partial<ParseTaskDraft>) => {
    setTasks((list) => list.map((t) => (t.key === key ? { ...t, ...patch } : t)));
    setDirty(true);
  };
  const editDecision = (key: string | undefined, patch: Partial<ParseDecision>) => {
    setDecisions((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    setDirty(true);
  };

  /** Сохранить черновик: true, если сохранилось. Новая версия запоминается сразу */
  const persist = async (): Promise<string | true> => {
    const r = await saveParseDraftAction(view.id, { ...(view.canSeeCeo ? { ceo } : {}), tasks, decisions }, version);
    if (!r.ok) return r.error;
    setVersion(r.value.updatedAt);
    setDirty(false);
    return true;
  };

  const save = async () => {
    setBusy("save");
    try {
      const r = await persist();
      if (r !== true) return notify(r, "error");
      notify("Черновик сохранён");
      router.refresh();
    } catch {
      notify("Нет связи с сервером: черновик не сохранился", "error");
    } finally {
      setBusy(null);
    }
  };

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.code === tab);
    const go = (j: number) => {
      e.preventDefault();
      choose(tabs[(j + tabs.length) % tabs.length]!.code, true);
    };
    if (e.key === "ArrowRight") go(i + 1);
    else if (e.key === "ArrowLeft") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(tabs.length - 1);
  };

  const common = { view, dirty, busy, setBusy, save, persist };
  return (
    <>
      <MethodNote view={view} />
      <div role="tablist" aria-label="Разбор встречи" className="sv-tabs" onKeyDown={onTabKey}>
        {tabs.map((t) => (
          <button
            key={t.code}
            ref={(el) => {
              tabRefs.current[t.code] = el;
            }}
            type="button"
            role="tab"
            id={`parse-tab-${t.code}`}
            aria-selected={tab === t.code}
            aria-controls={`parse-panel-${t.code}`}
            tabIndex={tab === t.code ? 0 : -1}
            onClick={() => choose(t.code)}
            className={cn("sv-tabs__item", tab === t.code && "is-active")}
          >
            {t.label}
            {t.code === "tasks" ? <span className="ml-1.5 text-muted">{tasks.length}</span> : null}
          </button>
        ))}
      </div>
      <section role="tabpanel" id="parse-panel-summary" aria-labelledby="parse-tab-summary" hidden={tab !== "summary"}>
        <Summary view={view} />
      </section>
      {view.canSeeCeo ? (
        <section role="tabpanel" id="parse-panel-ceo" aria-labelledby="parse-tab-ceo" hidden={tab !== "ceo"}>
          <CeoTab {...common} ceo={ceo} edit={editCeo} />
        </section>
      ) : null}
      <section role="tabpanel" id="parse-panel-tasks" aria-labelledby="parse-tab-tasks" hidden={tab !== "tasks"}>
        <TasksTab {...common} tasks={tasks} edit={editTask} decisions={decisions} editDecision={editDecision} />
      </section>
    </>
  );
}

function MethodNote({ view }: { view: ParseView }) {
  if (view.method === "rules") {
    return (
      <div className="flex gap-3 sv-card sv-card--soft bg-warning-soft px-5 py-4" data-testid="parse-method">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-ink" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium text-warning-ink">Разобрано правилами</p>
          <p className="mt-0.5 break-words text-body text-ink">{view.note ?? "Разбор по заголовкам и спискам страницы: проверьте итоги и задачи внимательнее"}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3 sv-card sv-card--soft px-5 py-4" data-testid="parse-method">
      <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium text-ink">Разобрал Claude{view.model ? ` (${view.model})` : ""}</p>
        <p className="mt-0.5 break-words text-body text-muted">Проверьте итоги, weekly и задачи перед отправкой: ничего не уходит без вашей проверки.{view.note ? ` ${view.note}` : ""}</p>
      </div>
    </div>
  );
}

function List({ title, items, empty }: { title: string; items: React.ReactNode[]; empty: string }) {
  return (
    <div>
      <h2 className="text-title-sm font-semibold text-ink">{title}</h2>
      {items.length ? (
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-body text-ink">
          {items.map((it, i) => (
            <li key={i} className="break-words">
              {it}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-body text-muted">{empty}</p>
      )}
    </div>
  );
}

function Summary({ view }: { view: ParseView }) {
  const r = view.result;
  return (
    <div className="flex flex-col gap-6 pt-4">
      {r.unreadable ? (
        <p className="sv-card sv-card--soft bg-warning-soft px-4 py-3 text-body text-ink" data-testid="parse-unreadable">
          {r.unreadable} {plural(r.unreadable, "блок", "блока", "блоков")} не прочитано: например, AI-заметки встречи Notion API не отдаёт. Если итогов там больше, перенесите их обычным текстом на страницу и разберите ещё раз.
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <List title="Главное" items={r.summary} empty="Главное из текста не выделилось" />
        <List
          title="Решения"
          items={r.decisions.map((d) => (
            <>
              {d.text}
              {d.owner ? <span className="text-muted">. Владелец: {compactName(d.owner as PersonSlug)}</span> : d.ownerText ? <span className="text-muted">. Владелец в тексте: {d.ownerText}</span> : null}
            </>
          ))}
          empty="Решений в тексте не нашлось"
        />
        <List title="Риски" items={r.risks} empty="Рисков в тексте не нашлось" />
        <List title="Что дальше" items={r.next} empty="Следующих шагов отдельно не названо" />
      </div>
      {view.canSeeText ? (
        <details className="sv-card sv-card--soft">
          <summary className="cursor-pointer px-4 py-3 text-body font-medium text-ink">Текст страницы из Notion</summary>
          <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words border-t border-line px-4 py-3 font-sans text-small text-ink">{view.pageText || "Страница пустая"}</pre>
        </details>
      ) : (
        <p className="text-small text-muted">Полный текст страницы видят те, кто ведёт встречу. Здесь итоги и черновики.</p>
      )}
    </div>
  );
}

const SECTIONS: { key: keyof CeoSections; label: string }[] = [
  { key: "main", label: "Главное" },
  { key: "risks", label: "Риски" },
  { key: "next", label: "Что дальше" },
];

type TabProps = { view: ParseView; dirty: boolean; busy: Busy; setBusy: (b: Busy) => void; save: () => Promise<void>; persist: () => Promise<string | true> };

function SaveButton({ view, dirty, busy, save }: Pick<TabProps, "view" | "dirty" | "busy" | "save">) {
  if (!view.canEdit) return null;
  return (
    <Button variant="secondary" disabled={busy !== null || !dirty} onClick={() => void save()}>
      <Save className="h-4 w-4" aria-hidden="true" />
      {busy === "save" ? "Сохраняем…" : "Сохранить черновик"}
    </Button>
  );
}

function CeoTab({ view, ceo, edit, dirty, busy, setBusy, save, persist }: TabProps & { ceo: CeoSections; edit: (p: Partial<CeoSections>) => void }) {
  const router = useRouter();
  const { notify } = usePrototype();
  const existing = view.ceo?.existing.sections ?? null;
  const filled = hasCeoText(existing);
  const [mode, setMode] = useState<CeoMergeMode>("merge");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const result = mergeCeoSections(existing, ceo, filled ? mode : "replace");
  // В предпросмотре «Мои встречи недели» из отчёта недели: их отправка не трогает
  const meetings = view.ceo?.existing.meetings ?? [];

  const send = async () => {
    setBusy("send");
    setError(null);
    try {
      if (dirty && view.canEdit) {
        const s = await persist();
        if (s !== true) return setError(s);
      }
      const r = await sendParseToCeoAction(view.id, { ceo, mode: filled ? mode : null, expected: view.ceo?.existing.updatedAt ?? null });
      if (!r.ok) return setError(r.error);
      setConfirm(false);
      notify(`Weekly отправлен CEO: ${view.ceo?.recipients.join(", ") ?? ""}`);
      router.refresh();
    } catch {
      setError("Нет связи с сервером: weekly не отправлен");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 pt-4">
      {view.ceoSentAt ? (
        <p className="flex items-start gap-2 sv-card sv-card--soft bg-green-soft px-4 py-3 text-body text-ink" data-testid="ceo-sent">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-ink" aria-hidden="true" />
          <span>
            Отправлено CEO {moment(view.ceoSentAt)}
            {view.ceoSentBy ? `, отправил ${view.ceoSentBy}` : ""}. CEO видит собранный отчёт на странице «Отчёт CEO» и событие в «Мне». Можно поправить и отправить ещё раз.
          </span>
        </p>
      ) : null}
      <p className="max-w-[760px] text-body text-muted">
        Черновик weekly для CEO в разделах отчёта CEO за неделю {view.weekNumber}. Каждая мысль отдельной строкой, начинается с «- ». Цифры недели, решения и благодарности отчёт соберёт сам: ниже видно, что получит CEO.
      </p>
      <div className="grid gap-4">
        {SECTIONS.map((s) => (
          <TextArea
            key={s.key}
            label={s.label}
            id={`ceo-${s.key}`}
            value={ceo[s.key]}
            onChange={(e) => edit({ [s.key]: e.target.value })}
            rows={Math.min(12, Math.max(3, ceo[s.key].split("\n").length + 1))}
            readOnly={!view.canEdit}
          />
        ))}
      </div>

      {view.ceo ? (
        <div className="flex flex-col gap-3 sv-card sv-card--soft px-5 py-4">
          <p className="text-body text-ink">
            Получит: <span className="font-medium">{view.ceo.recipients.length ? view.ceo.recipients.join(", ") : "CEO не найден"}</span>. Только в приложении: событие в «Мне» и отчёт на странице «Отчёт CEO».
          </p>
          {filled ? (
            <>
              <p className="text-body text-ink">
                За неделю {view.weekNumber} уже есть отчёт CEO
                {view.ceo.existing.updatedBy ? `: сохранил ${view.ceo.existing.updatedBy}` : ""}
                {view.ceo.existing.updatedAt ? `, ${moment(view.ceo.existing.updatedAt)}` : ""}. Молча он не заменится: выберите, что сделать.
              </p>
              <Segmented<CeoMergeMode>
                label="Что сделать с отчётом недели"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "merge", label: "Дописать по разделам" },
                  { value: "replace", label: "Заменить отчёт" },
                ]}
              />
              <p className="text-small text-muted">
                {mode === "merge" ? "Строки встречи допишутся в конец каждого раздела, строки, которые уже есть, второй раз не попадут." : "Разделы «Главное», «Риски» и «Что дальше» станут такими, как в черновике. «Мои встречи недели» останутся."}
              </p>
              {mode === "replace" ? (
                <details className="rounded-lg bg-surface ring-1 ring-line">
                  <summary className="cursor-pointer px-4 py-2.5 text-body font-medium text-ink">Что будет заменено</summary>
                  <div className="grid gap-3 border-t border-line px-4 py-3 lg:grid-cols-3">
                    {SECTIONS.map((s) => (
                      <div key={s.key} className="min-w-0">
                        <p className="text-caption font-semibold text-muted">{s.label}</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-small text-muted line-through decoration-line">{existing?.[s.key] || "Раздел пустой"}</p>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {view.ceoPreview ? (
        <section aria-labelledby="ceo-preview-title" className="flex flex-col gap-3 rounded-xl px-4 py-4 ring-1 ring-line sm:px-5" data-testid="ceo-preview">
          <h2 id="ceo-preview-title" className="text-title-sm font-semibold text-ink">
            Что получит CEO: отчёт за неделю {view.weekNumber}
          </h2>
          <CeoAssembled ctx={view.ceoPreview} sections={result} meetings={meetings} idPrefix="ceo-preview" />
        </section>
      ) : null}

      {view.sendHint ? <p className="text-body text-muted">{view.sendHint}</p> : null}
      <FormError message={error ?? undefined} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <SaveButton view={view} dirty={dirty} busy={busy} save={save} />
        {view.canSendCeo ? (
          <Button onClick={() => (hasCeoText(ceo) ? setConfirm(true) : setError("Weekly для CEO пустой: напишите хотя бы главное"))} disabled={busy !== null}>
            <Send className="h-4 w-4" aria-hidden="true" />
            {view.ceoSentAt ? "Отправить CEO ещё раз" : "Отправить CEO"}
          </Button>
        ) : null}
      </div>
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Отправить weekly CEO?"
        description={`Получит: ${view.ceo?.recipients.join(", ") || "CEO"}. ${filled ? (mode === "merge" ? "Черновик допишется к отчёту недели по разделам." : "Черновик заменит разделы отчёта недели.") : "Отчёт CEO за неделю сохранится из черновика."} Отправка только в приложении, без письма.`}
      >
        <FormError message={error ?? undefined} />
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Отмена
          </Button>
          <Button onClick={() => void send()} disabled={busy !== null} loading={busy === "send"}>
            {busy === "send" ? "Отправляем…" : "Отправить"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function TasksTab({
  view,
  tasks,
  edit,
  decisions,
  editDecision,
  dirty,
  busy,
  setBusy,
  save,
}: TabProps & { tasks: ParseTaskDraft[]; edit: (key: string, p: Partial<ParseTaskDraft>) => void; decisions: ParseDecision[]; editDecision: (key: string | undefined, p: Partial<ParseDecision>) => void }) {
  const router = useRouter();
  const { notify, data } = usePrototype();
  const [error, setError] = useState<string | null>(null);
  const chosen = tasks.filter((t) => t.on);
  const missing = chosen.filter((t) => !t.owner);
  const chosenDecisions = decisions.filter((d) => d.on);

  const create = async () => {
    if (missing.length) return setError(`Выберите ответственного: ${missing.map((t) => `«${t.title}»`).join(", ")}`);
    if (!chosen.length && !chosenDecisions.length) return setError("Отметьте задачи или решения, которые записать");
    setBusy("tasks");
    setError(null);
    try {
      const r = await createParseTasksAction(view.id, { tasks, decisions });
      if (!r.ok) return setError(r.error);
      const pending = r.value.created.filter((t) => t.approval === "pending").length;
      notify(
        r.value.already
          ? "Задачи уже созданы раньше: повторно ничего не создано"
          : `Создано ${r.value.numbers.length} ${plural(r.value.numbers.length, "задача", "задачи", "задач")}${pending ? `, на согласовании ${pending}` : ""}${r.value.decisions ? `, решений ${r.value.decisions}` : ""}`,
      );
      router.refresh();
    } catch {
      setError("Нет связи с сервером: задачи не созданы");
    } finally {
      setBusy(null);
    }
  };

  if (view.tasksCreatedAt) {
    return (
      <div className="flex flex-col gap-4 pt-4" data-testid="tasks-created">
        <p className="flex items-start gap-2 sv-card sv-card--soft bg-green-soft px-4 py-3 text-body text-ink">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-ink" aria-hidden="true" />
          <span>
            Задачи созданы {moment(view.tasksCreatedAt)}
            {view.tasksCreatedBy ? `, создал ${view.tasksCreatedBy}` : ""}: {view.createdTasks.length} {plural(view.createdTasks.length, "задача", "задачи", "задач")}
            {view.decisionsCreated ? `, решений в журнале ${view.decisionsCreated}` : ""}. Повторно из этого разбора задачи не создаются.
          </span>
        </p>
        <ul className="flex flex-col divide-y divide-line sv-card sv-card--soft">
          {view.createdTasks.map((t) => (
            <li key={t.number} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between">
              <Link href={`/tasks/${t.number}`} className="min-w-0 break-words text-body font-medium text-ink hover:text-blue-700 hover:underline">
                <span className="mr-1.5 tabular-nums text-muted">{t.number}</span>
                {t.title}
              </Link>
              <span className="text-caption text-muted">
                {t.owner ? compactName(t.owner) : "без ответственного"}
                {t.approval === "pending" ? `. Ждёт согласования: ${t.approver ?? "руководитель"}` : t.approval === "informed" ? `. Руководитель проинформирован: ${t.approver ?? ""}` : t.proposed ? ". Предложена" : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-4">
      <p className="max-w-[760px] text-body text-muted">
        Черновики задач из встречи. Уберите лишние, поправьте ответственного и срок. «Создать задачи» поставит все отмеченные разом, в команду «{view.team.name}». Задачи людям других департаментов уйдут на согласование их руководителю, если так настроено.
      </p>
      {!tasks.length ? <p className="sv-card sv-card--soft px-4 py-3 text-body text-muted">Задач в тексте встречи не нашлось.</p> : null}
      <ol className="flex flex-col gap-3">
        {tasks.map((t, i) => (
          <DraftCard key={t.key} index={i} task={t} edit={(p) => edit(t.key, p)} readOnly={!view.canEdit} today={data.today} team={view.team.name} />
        ))}
      </ol>

      {decisions.length ? (
        <section aria-labelledby="parse-decisions" className="flex flex-col gap-3 sv-card sv-card--soft p-4" data-testid="decision-drafts">
          <div>
            <h2 id="parse-decisions" className="text-title-sm font-semibold text-ink">
              Решения встречи в журнал решений
            </h2>
            <p className="mt-1 text-small text-muted">Запишутся только отмеченные, вместе с задачами. Текст можно поправить.</p>
          </div>
          <ol className="flex flex-col gap-3">
            {decisions.map((d, i) => (
              <li key={d.key ?? i} className="flex flex-col gap-2" data-testid="decision-draft">
                <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-body text-ink">
                  <input type="checkbox" checked={!!d.on} disabled={!view.canEdit} onChange={(e) => editDecision(d.key, { on: e.target.checked })} className="h-4 w-4 accent-blue-700" />
                  Записать решение {i + 1}
                </label>
                <TextArea label={`Текст решения ${i + 1}`} id={`decision-${d.key ?? i}`} value={d.text} rows={2} maxLength={1000} readOnly={!view.canEdit} onChange={(e) => editDecision(d.key, { text: e.target.value })} />
                {d.owner ? <p className="text-small text-muted">Владелец: {personName(d.owner)}</p> : d.ownerText ? <p className="text-small text-muted">Владелец в тексте: {d.ownerText}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {view.tasksHint ? <p className="text-body text-muted">{view.tasksHint}</p> : null}
      <FormError message={error ?? undefined} />
      {view.canEdit ? (
        <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body text-ink">
            Будет создано: {chosen.length} {plural(chosen.length, "задача", "задачи", "задач")}
            {chosenDecisions.length ? `, решений ${chosenDecisions.length}` : ""}
            {missing.length ? <span className="text-danger-ink">. Без ответственного: {missing.length}</span> : null}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <SaveButton view={view} dirty={dirty} busy={busy} save={save} />
            {view.canCreateTasks ? (
              <Button onClick={() => void create()} disabled={busy !== null} loading={busy === "tasks"}>
                {busy === "tasks" ? "Создаём…" : "Создать задачи"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DraftCard({ index, task: t, edit, readOnly, today, team }: { index: number; task: ParseTaskDraft; edit: (p: Partial<ParseTaskDraft>) => void; readOnly: boolean; today: string; team: string }) {
  const id = `draft-${t.key}`;
  const noOwner = t.on && !t.owner;
  // Поля, от которых зависит цель, поменяли на экране: цель проверится при сохранении или создании
  const [touched, setTouched] = useState(false);
  const change = (p: Partial<ParseTaskDraft>, goal = false) => {
    if (goal) setTouched(true);
    edit(p);
  };
  return (
    <li className={cn("flex flex-col gap-3 sv-card sv-card--soft p-4", !t.on && "opacity-60", noOwner && "ring-2 ring-danger")} data-testid="task-draft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-body font-medium text-ink">
          <input type="checkbox" checked={t.on} disabled={readOnly} onChange={(e) => edit({ on: e.target.checked })} className="h-4 w-4 accent-blue-700" />
          Создать задачу {index + 1}
        </label>
        <span className="text-caption text-muted">Команда: {team}</span>
      </div>
      {t.existing ? (
        <p className="text-small text-warning-ink" data-testid="draft-existing">
          Уже есть задача{" "}
          <Link href={`/tasks/${t.existing}`} className="font-semibold underline-offset-2 hover:underline">
            {t.existing}
          </Link>
          : её создали из прошлого разбора этой встречи. Строка снята, отметьте, если нужна ещё одна.
        </p>
      ) : null}
      <TextInput label="Задача" id={`${id}-title`} value={t.title} maxLength={120} readOnly={readOnly} onChange={(e) => change({ title: e.target.value }, true)} />
      <TextArea label="Что нужно сделать" id={`${id}-outcome`} value={t.outcome} rows={2} maxLength={1000} readOnly={readOnly} onChange={(e) => change({ outcome: e.target.value }, true)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          {readOnly ? (
            <TextInput label="Ответственный" id={`${id}-owner`} value={t.owner ? personName(t.owner) : "не выбран"} readOnly />
          ) : (
            <PersonSelect id={`${id}-owner`} label="Ответственный" value={t.owner ?? ""} onChange={(v) => change({ owner: v || null, coExecutors: t.coExecutors.filter((c) => c !== v) }, true)} exclude={"" as PersonSlug} />
          )}
          {!t.owner ? (
            <p className={cn("text-small", t.on ? "text-danger-ink" : "text-muted")}>
              {t.ownerText ? `В тексте встречи «${t.ownerText}»: такого человека однозначно не нашлось. Выберите ответственного` : "Ответственный не назван: выберите человека"}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <TextInput label="Срок" id={`${id}-due`} type="date" min={today} value={t.due} readOnly={readOnly} onChange={(e) => change({ due: e.target.value, dueGuessed: false }, true)} />
          {t.dueGuessed ? <p className="text-small text-warning-ink">Срок не назван на встрече: подставлен через неделю, проверьте</p> : t.dueText ? <p className="text-small text-muted">В тексте: «{t.dueText}»</p> : null}
        </div>
        <SelectField label="Направление" id={`${id}-direction`} value={t.direction} disabled={readOnly} onChange={(e) => edit({ direction: e.target.value })} options={dictOptions("DIRECTION", t.direction)} />
        <div className="flex flex-col gap-1">
          <span className="sv-label">Соисполнители</span>
          {t.coExecutors.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {t.coExecutors.map((c) => (
                <li key={c} className="inline-flex items-center gap-1 rounded-full bg-field px-2.5 py-1 text-small text-ink">
                  {compactName(c as PersonSlug)}
                  {!readOnly ? (
                    <button type="button" aria-label={`Убрать соисполнителя ${personName(c)}`} onClick={() => change({ coExecutors: t.coExecutors.filter((x) => x !== c) }, true)} className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-surface">
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-small text-muted">нет</span>
          )}
          {t.coText.length ? <p className="text-small text-muted">В тексте ещё: {t.coText.join(", ")}. Добавьте, если это люди компании</p> : null}
          {!readOnly && t.coExecutors.length < 5 ? (
            <PersonSelect
              id={`${id}-co`}
              label="Добавить соисполнителя"
              value=""
              onChange={(v) => v && v !== t.owner && !t.coExecutors.includes(v) && change({ coExecutors: [...t.coExecutors, v] }, true)}
              exclude={(t.owner ?? "") as PersonSlug}
            />
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-1 text-small">
        <p className="text-ink">
          Цель: {t.goalMode === "none" ? <span className="text-muted">без цели</span> : t.goalTitle ? <span>{t.goalTitle}</span> : <span className="text-muted">по тексту не нашлась</span>}
          {t.goalMode === "auto" && touched ? <span className="text-muted">. Поля поменялись: цель проверится при сохранении и при создании</span> : null}
        </p>
        {!readOnly ? (
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-ink">
            <input type="checkbox" checked={t.goalMode === "none"} onChange={(e) => edit({ goalMode: e.target.checked ? "none" : "auto" })} className="h-4 w-4 accent-blue-700" />
            Без цели
          </label>
        ) : null}
      </div>
    </li>
  );
}
