"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, CloudUpload, Copy, ExternalLink, RotateCcw, ScanSearch, TriangleAlert, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { TextInput } from "@/components/ui/primitives";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { usePrototype } from "@/domain/store";
import { pushNowAction, rebuildNowAction, reconcileNowAction, setSpreadsheetAction } from "@/app/(app)/sync/actions";
import { BordPull, type BordView } from "./bord-pull";

type Tone = "ok" | "warn" | "error" | "pending";

export type SyncView = {
  connected: boolean;
  imitation: boolean;
  spreadsheetId: string | null;
  serviceEmail: string | null;
  hasKey: boolean;
  queue: { size: number; waitingMin: number | null };
  lagging: boolean;
  lastPush: { ago: string; at: string } | null;
  reconcile: { at: string; text: string; tone: Tone } | null;
  nextReconcile: string;
  error: { at: string; kind: string; message: string } | null;
  runs: { id: string; at: string; kind: string; text: string; tone: Tone }[];
  counts: { tasks: number; comments: number; entries: number };
  bord: BordView;
};

const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

function plural(n: number, one: string, few: string, many: string) {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

function ToneIcon({ tone }: { tone: Tone }) {
  const cls = "h-4 w-4 shrink-0";
  if (tone === "ok") return <CheckCircle2 className={cn(cls, "text-green-ink")} aria-hidden="true" />;
  if (tone === "warn") return <TriangleAlert className={cn(cls, "text-warning-ink")} aria-hidden="true" />;
  if (tone === "error") return <XCircle className={cn(cls, "text-danger-ink")} aria-hidden="true" />;
  return <CircleDashed className={cn(cls, "text-muted")} aria-hidden="true" />;
}

/** Страница синхронизации для владельца: забор задач из Bord, затем таблица для просмотра: подключение, последняя выгрузка, очередь, сверка, история (раздел 5 ТЗ) */
export function SyncStatus({ view }: { view: SyncView }) {
  const router = useRouter();
  const run = useRunAction();
  const { notify } = usePrototype();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  // Страница живая: состояние очереди и забора обновляется само раз в 30 секунд, как и фоновый цикл
  const live = view.connected || view.bord.connected;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [router, live]);

  async function act<T>(name: string, fn: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>, okText: (v: T) => string) {
    setBusy(name);
    try {
      const value = await run(fn);
      if (value !== null) notify(okText(value));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-12">
      {view.imitation ? (
        <p className="rounded-xl border border-dashed border-line px-5 py-3 text-body text-ink">
          Режим имитации: вместо Google ресурс читает и пишет таблицы в памяти сервера. Так проверяют забор и выгрузку без ключа служебного аккаунта.
        </p>
      ) : null}

      <BordPull view={view.bord} />

      <section aria-labelledby="sync-mirror" className="flex flex-col gap-8">
      <div>
        <h2 id="sync-mirror" className="text-title font-semibold text-ink">
          Таблица для просмотра
        </h2>
        <p className="mt-1 max-w-[760px] text-body text-ink">
          Ресурс сам пишет в отдельную Google-таблицу все задачи, и из Bord, и заведённые в ресурсе, а ещё комментарии и weekly. В одну сторону: таблицу правит только ресурс.
        </p>
        <p className="mt-2 max-w-[760px] rounded-lg bg-warning-soft px-4 py-3 text-body text-ink">
          В таблице задачи всех команд департамента, колонка «Команда» показывает, чья задача. Давайте доступ к ней только тем, кому можно видеть весь департамент: права ресурса на таблицу не распространяются.
        </p>
      </div>

      {view.connected ? <Tiles view={view} /> : null}

      {view.error ? (
        <div role="alert" className="flex gap-3 rounded-xl bg-danger-soft px-5 py-4 text-body text-ink">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger-ink" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-danger-ink">
              {view.error.kind} не прошла {view.error.at}
            </p>
            <p className="mt-0.5 break-words">{view.error.message}</p>
            <p className="mt-1 text-small text-muted">Правки ждут в очереди и не теряются. Повтор через минуту, при новых ошибках реже, до раза в 5 минут.</p>
          </div>
        </div>
      ) : null}

      {view.connected ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy !== null} onClick={() => act("push", pushNowAction, (r) => (r.items ? `Выгружено: ${r.items} ${plural(r.items, "строка", "строки", "строк")}` : "Таблица уже совпадает с ресурсом"))}>
            <CloudUpload className="h-4 w-4" aria-hidden="true" />
            {busy === "push" ? "Выгружаем…" : "Выгрузить сейчас"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() =>
              act("reconcile", reconcileNowAction, (r) => {
                const n = r.details.diffs.length + r.details.removed.length + r.details.restored.length;
                return n ? `Сверка вернула значения ресурса: ${n}` : "Сверка: расхождений нет";
              })
            }
          >
            <ScanSearch className="h-4 w-4" aria-hidden="true" />
            {busy === "reconcile" ? "Сверяем…" : "Сверить сейчас"}
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirm(true)}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {busy === "rebuild" ? "Пересобираем…" : "Пересобрать вкладки"}
          </Button>
        </div>
      ) : null}

      <Connection view={view} />

      <section aria-labelledby="sync-tabs">
        <h3 id="sync-tabs" className="mb-3 text-title-sm font-semibold text-ink">
          Вкладки ресурса в таблице
        </h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {[
            ["Задачи", `${view.counts.tasks} ${plural(view.counts.tasks, "строка", "строки", "строк")}, без архива`],
            ["Комментарии к задачам", `${view.counts.comments} ${plural(view.counts.comments, "строка", "строки", "строк")}`],
            ["Weekly", `${view.counts.entries} ${plural(view.counts.entries, "строка", "строки", "строк")}`],
            ["Журнал выгрузки", "что и когда выгружено, ночью сокращается до 2000 строк"],
            ["Сводка", "формулы по лидерам"],
          ].map(([name, note]) => (
            <li key={name} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-lg px-4 py-3 ring-1 ring-line">
              <span className="text-body font-medium text-ink">{name}</span>
              <span className="text-small text-muted">{note}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-small text-muted">
          Вкладки защищены: кроме служебного аккаунта их может править только владелец таблицы, и такую правку ночная сверка вернёт и запишет в журнал. Вкладки с такими же названиями, которые были в таблице до подключения, ресурс переименовывает в «… (архив до запуска)», остальные вкладки не трогает. Отчёт CEO в таблицу не выгружается.
        </p>
      </section>

      <section aria-labelledby="sync-log">
        <h3 id="sync-log" className="mb-3 text-title-sm font-semibold text-ink">
          История выгрузок
        </h3>
        {view.runs.length ? (
          <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
            {view.runs.map((r) => (
              <li key={r.id} className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 px-4 py-3 text-body sm:grid-cols-[150px_110px_1fr]">
                <span className="tabular-nums text-muted">{r.at}</span>
                <span className="text-ink">{r.kind}</span>
                <span className={cn("col-span-2 inline-flex min-w-0 items-start gap-1.5 sm:col-span-1", r.tone === "error" ? "text-danger-ink" : r.tone === "warn" ? "text-warning-ink" : "text-ink")}>
                  <span className="mt-0.5">
                    <ToneIcon tone={r.tone} />
                  </span>
                  <span className="min-w-0 break-words">{r.text}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl px-5 py-4 text-body text-muted ring-1 ring-line">Выгрузок ещё не было. Первая начнётся в течение 30 секунд после подключения таблицы.</p>
        )}
      </section>
      </section>

      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Пересобрать вкладки ресурса?"
        description="Вкладки «Задачи», «Комментарии к задачам» и «Weekly» перепишутся целиком из ресурса, «Сводка» пересчитается. Остальные вкладки таблицы не трогаем."
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              setConfirm(false);
              void act("rebuild", rebuildNowAction, (r) => `Вкладки пересобраны: ${r.items} ${plural(r.items, "строка", "строки", "строк")}`);
            }}
          >
            Пересобрать
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Tiles({ view }: { view: SyncView }) {
  const fresh = view.lastPush && !view.lagging && !view.error;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className={cn("rounded-xl px-5 py-4", fresh ? "bg-green-soft" : view.lagging ? "bg-warning-soft" : "bg-surface")}>
        <p className={cn("inline-flex items-center gap-2 text-small font-medium", fresh ? "text-green-ink" : view.lagging ? "text-warning-ink" : "text-muted")}>
          {fresh ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : view.lagging ? <TriangleAlert className="h-4 w-4" aria-hidden="true" /> : null}
          Последняя выгрузка
        </p>
        <p className="mt-1 text-headline-lg font-semibold tabular-nums text-ink">{view.lastPush ? view.lastPush.ago : "ещё не было"}</p>
        <p className="text-caption text-muted">{view.lastPush ? view.lastPush.at : "Начнётся в течение 30 секунд"}</p>
      </div>
      <div className={cn("rounded-xl px-5 py-4", view.lagging ? "bg-warning-soft" : "bg-surface")}>
        <p className={cn("text-small font-medium", view.lagging ? "text-warning-ink" : "text-muted")}>Очередь отправки</p>
        <p className="mt-1 text-headline-lg font-semibold tabular-nums text-ink">{view.queue.size}</p>
        <p className="text-caption text-muted">
          {view.queue.size === 0
            ? "Всё выгружено. Пакет уходит раз в 30 секунд"
            : view.queue.waitingMin
              ? `Самая старая правка ждёт ${view.queue.waitingMin} мин`
              : "Уйдёт в ближайшие 30 секунд"}
        </p>
      </div>
      <div className="rounded-xl bg-surface px-5 py-4">
        <p className="text-small font-medium text-muted">Сверка с таблицей</p>
        <p className={cn("mt-1 text-headline-sm font-semibold leading-tight", view.reconcile?.tone === "warn" ? "text-warning-ink" : view.reconcile?.tone === "error" ? "text-danger-ink" : "text-ink")}>
          {view.reconcile ? (view.reconcile.tone === "error" ? "не прошла" : view.reconcile.text) : "ещё не было"}
        </p>
        <p className="mt-1 text-caption text-muted">
          {view.reconcile ? `${view.reconcile.at}. ` : ""}Следующая: {view.nextReconcile}
        </p>
      </div>
    </div>
  );
}

function Connection({ view }: { view: SyncView }) {
  const run = useRunAction();
  const { notify } = usePrototype();
  const [link, setLink] = useState(view.spreadsheetId ? sheetUrl(view.spreadsheetId) : "");
  const [saving, setSaving] = useState(false);
  const changed = link.trim() !== (view.spreadsheetId ? sheetUrl(view.spreadsheetId) : "");

  async function save(value: string) {
    setSaving(true);
    try {
      const res = await run(() => setSpreadsheetAction(value));
      if (!res) return;
      if (!res.id) notify("Таблица отключена");
      else if (res.access === "ok") notify("Таблица подключена, доступ есть. Первая выгрузка в течение 30 секунд");
      else if (res.access === "no-key") notify("Ссылка сохранена. Выгрузка начнётся, когда на сервере появится ключ служебного аккаунта");
      else notify(`Ссылка сохранена, но ${res.access.charAt(0).toLowerCase()}${res.access.slice(1)}`, "error");
      setLink(res.id ? sheetUrl(res.id) : "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="sync-connection" className="rounded-xl px-5 py-5 ring-1 ring-line">
      <h3 id="sync-connection" className="text-title-sm font-semibold text-ink">
        Подключение таблицы для просмотра
      </h3>

      {!view.connected ? (
        <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-body text-ink marker:text-muted">
          <li className={cn(view.hasKey && "text-muted line-through decoration-line")}>Создать проект в Google Cloud, включить Google Sheets API, создать служебный аккаунт с ключом JSON (пошагово в инструкции к этапу 6)</li>
          <li className={cn(view.hasKey && "text-muted line-through decoration-line")}>Положить ключ в переменную GOOGLE_SERVICE_ACCOUNT_JSON в настройках приложения на Timeweb</li>
          <li>Создать Google-таблицу для просмотра и дать адресу служебного аккаунта доступ редактора. Рабочий Bord сюда не подходит: в него ресурс не пишет</li>
          <li>Вставить ссылку на таблицу ниже и сохранить</li>
        </ol>
      ) : null}

      <dl className="mt-4 grid gap-x-6 gap-y-3 text-body sm:grid-cols-[200px_1fr]">
        <dt className="text-muted">Ключ служебного аккаунта</dt>
        <dd className={view.hasKey ? "text-ink" : "text-warning-ink"}>{view.hasKey ? "задан на сервере" : "не задан: выгрузка не начнётся"}</dd>
        <dt className="text-muted">Адрес служебного аккаунта</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          {view.serviceEmail ? (
            <>
              <code className="min-w-0 break-all rounded bg-surface px-1.5 py-0.5 text-small text-ink">{view.serviceEmail}</code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(view.serviceEmail!).then(
                    () => notify("Адрес скопирован"),
                    () => notify("Не получилось скопировать: выделите адрес и скопируйте вручную", "error"),
                  );
                }}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                Скопировать
              </Button>
            </>
          ) : (
            <span className="text-muted">появится, когда задан ключ</span>
          )}
        </dd>
        <dt className="text-muted">Таблица для просмотра</dt>
        <dd className="min-w-0">
          {view.spreadsheetId ? (
            <a href={sheetUrl(view.spreadsheetId)} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 break-all text-blue-700 underline-offset-2 hover:underline">
              <span className="min-w-0 break-all">{view.spreadsheetId}</span>
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
            </a>
          ) : (
            <span className="text-muted">не подключена</span>
          )}
        </dd>
      </dl>

      <form
        aria-label="Ссылка на таблицу для просмотра"
        className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void save(link);
        }}
      >
        <TextInput
          label="Ссылка на таблицу для просмотра"
          id="sync-link"
          className="min-w-0 flex-1"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          hint="Сюда ресурс пишет все задачи. Рабочий Bord сюда не вставляйте: в него ресурс не пишет"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="flex gap-2 sm:pb-[26px]">
          <Button type="submit" disabled={saving || !changed}>
            {saving ? "Сохраняем…" : "Сохранить"}
          </Button>
          {view.spreadsheetId ? (
            <Button type="button" variant="secondary" disabled={saving} onClick={() => void save("")}>
              Отключить
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
