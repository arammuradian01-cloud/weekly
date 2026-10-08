"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Download, ExternalLink, TriangleAlert, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/primitives";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { usePrototype } from "@/domain/store";
import { pullBordNowAction, setBordSourceAction } from "@/app/(app)/sync/actions";

export type BordView = {
  sourceId: string | null;
  connected: boolean;
  hasKey: boolean;
  serviceEmail: string | null;
  /** Подключён рабочий Bord, а не копия */
  working: boolean;
  lastOk: { ago: string; at: string } | null;
  next: string | null;
  error: { at: string; message: string } | null;
  report: {
    rows: number;
    created: number[];
    updated: number[];
    fields: number;
    overwritten: number;
    renumbered: { from: number; to: number }[];
    /** Нет в отчётах до 07.10 */
    reused?: { number: number; to: number }[];
    newPeople: string[];
    problems: string[];
    missing: number[];
  } | null;
  history: { at: string; how: string; text: string; ok: boolean }[];
  firstNumber: number;
};

const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

function plural(n: number, one: string, few: string, many: string) {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

const tasksWord = (n: number) => `${n} ${plural(n, "задача", "задачи", "задач")}`;

/** Список номеров коротко: «12, 15, 40 и ещё 7» */
function numbers(list: number[], max = 12): string {
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} и ещё ${list.length - max}`;
}

/** Раздел «Задачи из Bord»: ресурс читает рабочий Bord раз в 5 минут и переносит задачи всех сотрудников */
export function BordPull({ view }: { view: BordView }) {
  const run = useRunAction();
  const { notify } = usePrototype();
  const [link, setLink] = useState(view.sourceId ? sheetUrl(view.sourceId) : "");
  const [busy, setBusy] = useState<"save" | "pull" | null>(null);
  const changed = link.trim() !== (view.sourceId ? sheetUrl(view.sourceId) : "");
  const r = view.report;

  async function save(value: string) {
    setBusy("save");
    try {
      const res = await run(() => setBordSourceAction(value));
      if (!res) return;
      if (!res.id) notify("Забор из Bord выключен. Задачи в ресурсе остаются");
      else if (res.access === "ok") notify("Bord подключён, доступ на чтение есть. Первый забор в течение минуты");
      else if (res.access === "no-key") notify("Ссылка сохранена. Забор начнётся, когда на сервере появится ключ служебного аккаунта");
      else notify(`Ссылка сохранена, но ${res.access.charAt(0).toLowerCase()}${res.access.slice(1)}`, "error");
      setLink(res.id ? sheetUrl(res.id) : "");
    } finally {
      setBusy(null);
    }
  }

  async function pull() {
    setBusy("pull");
    try {
      const res = await run(pullBordNowAction);
      if (!res) return;
      const parts = [res.created.length ? `новых ${res.created.length}` : "", res.updated.length ? `изменено ${res.updated.length}` : ""].filter(Boolean);
      notify(parts.length ? `Из Bord: ${parts.join(", ")}` : "Ресурс уже совпадает с Bord");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="bord-pull" className="flex flex-col gap-5">
      <div>
        <h2 id="bord-pull" className="text-title font-semibold text-ink">
          Задачи из Bord
        </h2>
        <p className="mt-1 max-w-[760px] text-body text-ink">
          Bord остаётся главным, пока не готова финальная версия ресурса. Ресурс раз в 5 минут читает вкладку «Задачи» и переносит задачи всех сотрудников. В Bord ресурс ничего не пишет.
        </p>
      </div>

      {view.connected && r ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className={cn("rounded-xl px-5 py-4", view.error ? "bg-warning-soft" : "bg-green-soft")}>
            <p className={cn("inline-flex items-center gap-2 text-small font-medium", view.error ? "text-warning-ink" : "text-green-ink")}>
              {view.error ? <TriangleAlert className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              Последний забор
            </p>
            <p className="mt-1 text-headline-lg font-semibold tabular-nums text-ink">{view.lastOk ? view.lastOk.ago : "ещё не было"}</p>
            <p className="text-caption text-muted">{view.lastOk ? view.lastOk.at : ""}</p>
          </div>
          <div className="sv-card sv-card--soft px-5 py-4">
            <p className="text-small font-medium text-muted">Задач в Bord</p>
            <p className="mt-1 text-headline-lg font-semibold tabular-nums text-ink">{r.rows}</p>
            <p className="text-caption text-muted">строк с номером во вкладке «Задачи»</p>
          </div>
          <div className="sv-card sv-card--soft px-5 py-4">
            <p className="text-small font-medium text-muted">Последний раз перенесено</p>
            <p className="mt-1 text-headline-sm font-semibold leading-tight text-ink">
              {r.created.length || r.updated.length ? `новых ${r.created.length}, изменено ${r.updated.length}` : "изменений не было"}
            </p>
            <p className="mt-1 text-caption text-muted">Следующий забор: {view.next ?? "выключен"}</p>
          </div>
        </div>
      ) : null}

      {view.connected && !r && !view.error ? <p className="sv-card sv-card--soft px-5 py-4 text-body text-ink">Первый забор пройдёт в течение минуты. Можно не ждать: «Забрать сейчас».</p> : null}

      {view.error ? (
        <div role="alert" className="flex gap-3 sv-card sv-card--soft bg-danger-soft px-5 py-4 text-body text-ink">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger-ink" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-danger-ink">Забор не прошёл {view.error.at}</p>
            <p className="mt-0.5 break-words">{view.error.message}</p>
            <p className="mt-1 text-small text-muted">В ресурсе ничего не изменилось. Повтор через 15 минут.</p>
          </div>
        </div>
      ) : null}

      {view.connected ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy !== null} onClick={() => void pull()}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {busy === "pull" ? "Забираем…" : "Забрать сейчас"}
          </Button>
        </div>
      ) : null}

      {r && view.connected ? <ReportDetails report={r} firstNumber={view.firstNumber} /> : null}

      <div className="sv-card sv-card--soft px-5 py-5">
        <h3 className="text-title-sm font-semibold text-ink">Подключение Bord</h3>
        {!view.connected ? (
          <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-body text-ink marker:text-muted">
            <li>В Bord: «Настройки доступа», добавить адрес служебного аккаунта ниже, право «Читатель». Права редактора не нужны</li>
            <li>Вставить ссылку на Bord и сохранить. Первый забор пройдёт в течение минуты</li>
          </ol>
        ) : null}
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-body sm:grid-cols-[200px_1fr]">
          <dt className="text-muted">Адрес служебного аккаунта</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2">
            {view.serviceEmail ? (
              <>
                <code className="min-w-0 break-all rounded bg-field px-1.5 py-0.5 text-small text-ink">{view.serviceEmail}</code>
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
              <span className="text-warning-ink">появится, когда на сервере задан ключ</span>
            )}
          </dd>
          <dt className="text-muted">Bord</dt>
          <dd className="min-w-0">
            {view.sourceId ? (
              <a href={sheetUrl(view.sourceId)} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 break-all text-blue-700 underline-offset-2 hover:underline">
                <span className="min-w-0 break-all">{view.working ? "рабочий Insurance&Invest Bord" : view.sourceId}</span>
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-muted">забор выключен</span>
            )}
          </dd>
        </dl>
        <form
          aria-label="Ссылка на Bord"
          className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void save(link);
          }}
        >
          <TextInput
            label="Ссылка на Bord"
            id="bord-link"
            className="min-w-0 flex-1"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            hint="Ресурс только читает вкладку «Задачи». Его правки в Bord не попадают"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex gap-2 sm:pb-[26px]">
            <Button type="submit" disabled={busy !== null || !changed}>
              {busy === "save" ? "Сохраняем…" : "Сохранить"}
            </Button>
            {view.sourceId ? (
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void save("")}>
                Выключить забор
              </Button>
            ) : null}
          </div>
        </form>
      </div>

      {view.history.length ? (
        <details className="sv-card sv-card--soft">
          <summary className="cursor-pointer px-4 py-3 text-body font-medium text-ink">История заборов</summary>
          <ul className="divide-y divide-line border-t border-line">
            {view.history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-4 py-2.5 text-body sm:grid-cols-[150px_120px_1fr]">
                <span className="tabular-nums text-muted">{h.at}</span>
                <span className="text-ink">{h.how}</span>
                <span className={cn("col-span-2 min-w-0 break-words sm:col-span-1", h.ok ? "text-ink" : "text-danger-ink")}>{h.text}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function ReportDetails({ report: r, firstNumber }: { report: NonNullable<BordView["report"]>; firstNumber: number }) {
  const items: { key: string; tone: "info" | "warn"; title: string; body: string }[] = [];
  if (r.created.length) items.push({ key: "created", tone: "info", title: `Новые задачи из Bord: ${tasksWord(r.created.length)}`, body: `Номера: ${numbers(r.created)}` });
  if (r.updated.length) {
    items.push({
      key: "updated",
      tone: "info",
      title: `Изменены в ресурсе по Bord: ${tasksWord(r.updated.length)}, полей ${r.fields}`,
      body: `Номера: ${numbers(r.updated)}.${r.overwritten ? ` Правок, сделанных в ресурсе и заменённых значением из Bord: ${r.overwritten}.` : ""} Что именно поменялось, видно в журнале и в истории задачи`,
    });
  }
  if (r.newPeople.length) {
    items.push({
      key: "people",
      tone: "warn",
      title: `Новые люди из Bord: ${r.newPeople.length}`,
      body: `${r.newPeople.join(", ")}. Их не было в команде ресурса, ресурс добавил их с ролью «Лидер» и направлением «Департамент». Проверьте роль и направление в «Команде»: наблюдатель не сдаёт weekly`,
    });
  }
  if (r.renumbered.length) {
    items.push({
      key: "renumbered",
      tone: "warn",
      title: `Задачи ресурса получили новые номера: ${r.renumbered.length}`,
      body: `${r.renumbered.slice(0, 12).map((x) => `${x.from} стала ${x.to}`).join(", ")}${r.renumbered.length > 12 ? ` и ещё ${r.renumbered.length - 12}` : ""}. Номера до ${firstNumber - 1} у задач из Bord, задачи, заведённые в ресурсе, идут от ${firstNumber}`,
    });
  }
  const reused = r.reused ?? [];
  if (reused.length) {
    items.push({
      key: "reused",
      tone: "warn",
      title: `Номера в Bord отданы новым задачам: ${reused.length}`,
      body: `${reused.slice(0, 12).map((x) => `под номером ${x.number} теперь новая задача, прежняя стала ${x.to}`).join(", ")}${reused.length > 12 ? ` и ещё ${reused.length - 12}` : ""}. Прежние задачи остались в ресурсе со своей историей и попали в список «нет в Bord»: если они больше не нужны, отправьте их в архив`,
    });
  }
  if (r.problems.length) {
    items.push({ key: "problems", tone: "warn", title: `Не перенесено или перенесено не целиком: ${r.problems.length}`, body: r.problems.join("\n") });
  }
  if (r.missing.length) {
    items.push({
      key: "missing",
      tone: "info",
      title: `Есть в ресурсе, нет в Bord: ${tasksWord(r.missing.length)}`,
      body: `Номера: ${numbers(r.missing, 20)}. Их удалили из Bord или поменяли им номер. В ресурсе они остаются как были: если задача больше не нужна, отправьте её в архив`,
    });
  }
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it) => (
        <li key={it.key} className={cn("rounded-xl px-5 py-3.5 text-body", it.tone === "warn" ? "bg-warning-soft" : "bg-field")}>
          <p className={cn("font-medium", it.tone === "warn" ? "text-warning-ink" : "text-ink")}>{it.title}</p>
          <p className="mt-0.5 whitespace-pre-line break-words text-ink">{it.body}</p>
        </li>
      ))}
    </ul>
  );
}
