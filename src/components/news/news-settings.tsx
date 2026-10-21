"use client";

// Раздел «Новости» в настройках (этап 60), только владельцу: источники со состоянием последнего забора,
// ключевые слова по продуктам, «Забрать сейчас», состояние уточнения через Claude (без ключа, только да или нет)

import { useId, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { addNewsSourceAction, fetchNewsNowAction, removeNewsSourceAction, saveNewsKeywordsAction, setNewsSourceActiveAction, updateNewsSourceAction } from "@/app/(app)/news/actions";
import type { FetchResult, NewsDirection, SourceView } from "@/lib/news/service";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { TextArea, TextInput } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { formatDateTime } from "@/lib/week";

const STATUS: Record<SourceView["status"], { label: string; tone: BadgeTone }> = {
  ok: { label: "Работает", tone: "green" },
  error: { label: "Ошибка", tone: "red" },
  off: { label: "Выключен", tone: "gray" },
  new: { label: "Ещё не забирался", tone: "outline" },
};

export type NewsSettingsProps = {
  sources: SourceView[];
  keywords: Record<string, string[]>;
  directions: NewsDirection[];
  lastFetchAt: string | null;
  claude: { on: boolean; model: string };
};

export function NewsSettings({ sources, keywords, directions, lastFetchAt, claude }: NewsSettingsProps) {
  const headingId = useId();
  const run = useRunAction();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<SourceView | "new" | null>(null);
  const [report, setReport] = useState<FetchResult[] | null>(null);
  const withError = sources.filter((s) => s.status === "error");

  const toggle = async (s: SourceView) => {
    setBusy(s.id);
    await run(() => setNewsSourceActiveAction(s.id, !s.active), s.active ? "Источник выключен" : "Источник включён");
    setBusy(null);
  };
  const remove = async (s: SourceView) => {
    setBusy(s.id);
    await run(() => removeNewsSourceAction(s.id), "Источник удалён");
    setBusy(null);
  };
  const fetchNow = async () => {
    setBusy("fetch");
    const r = await run(() => fetchNewsNowAction(), "Ленты забраны");
    if (r) setReport(r);
    setBusy(null);
  };

  return (
    <section id="news" aria-labelledby={headingId} className="sv-toc-section border-t border-line py-8" data-testid="news-section">
      <div className="max-w-[72ch]">
        <h2 id={headingId} className="text-title font-semibold text-ink">
          Новости
        </h2>
        <p className="mt-1 text-small text-muted">
          Публичные ленты RSS и Atom забираются раз в час. Новость привязывается к продуктам по ключевым словам ниже; без слова ни по одному продукту она не сохраняется.
          Недоступный источник не мешает остальным: ошибка видна рядом с ним.
        </p>
        <p className="mt-1 text-small text-muted" data-testid="news-claude">
          {claude.on
            ? `Уточнение привязки и описания через Claude: подключено, модель ${claude.model}. Текст новостей уходит модели как данные, не как инструкции.`
            : "Уточнение через Claude не подключено: привязка и описание по правилам. Чтобы подключить, задайте на сервере ANTHROPIC_API_KEY (и при желании ANTHROPIC_MODEL)."}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => void fetchNow()} disabled={busy === "fetch"} loading={busy === "fetch"} data-testid="news-fetch-now">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Забрать сейчас
        </Button>
        <span className="text-small text-muted">{lastFetchAt ? `Последний забор ${formatDateTime(new Date(lastFetchAt))}` : "Ленты ещё не забирались"}</span>
        {withError.length ? (
          <Badge tone="red">
            С ошибкой: {withError.length}
          </Badge>
        ) : null}
      </div>
      {report ? (
        <p className="mt-2 text-small text-muted" data-testid="news-fetch-report">
          Лент {report.length}, новых новостей {report.reduce((n, r) => n + r.added, 0)}, с ошибкой {report.filter((r) => !r.ok).length}.
        </p>
      ) : null}

      <h3 className="mt-6 text-body font-semibold text-ink">Источники</h3>
      <ul className="mt-2 flex flex-col divide-y divide-line sv-card" aria-label="Источники новостей" data-testid="news-sources">
        {sources.map((s) => (
          <li key={s.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4" data-testid={`news-source-${s.id}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body font-semibold text-ink">{s.name}</span>
                <Badge tone={STATUS[s.status].tone} dot>
                  {STATUS[s.status].label}
                </Badge>
              </div>
              <p className="text-caption text-muted [overflow-wrap:anywhere]">{s.url}</p>
              <p className="text-caption text-muted">
                {s.lastFetchAt ? `Забор ${formatDateTime(new Date(s.lastFetchAt))}` : "Забора ещё не было"}
                {s.lastOkAt ? `, в ленте записей ${s.lastCount}` : ""}, новостей сохранено {s.items}
              </p>
              {s.lastError ? (
                <p className="text-caption text-danger-ink" data-testid="news-source-error">
                  Ошибка: {s.lastError}
                  {s.failCount > 1 ? ` (подряд ${s.failCount})` : ""}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(s)} disabled={busy === s.id} aria-label={`Изменить источник ${s.name}`}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Изменить
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => void toggle(s)} disabled={busy === s.id} aria-label={`${s.active ? "Выключить" : "Включить"} источник ${s.name}`}>
                {s.active ? "Выключить" : "Включить"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => void remove(s)} disabled={busy === s.id} aria-label={`Удалить источник ${s.name}`}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Удалить
              </Button>
            </div>
          </li>
        ))}
        {!sources.length ? <li className="px-4 py-3 text-small text-muted">Источников пока нет.</li> : null}
      </ul>
      <div className="mt-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => setEditing("new")} data-testid="news-add-source">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Добавить источник
        </Button>
      </div>

      <KeywordsForm keywords={keywords} directions={directions} />

      {editing ? <SourceModal source={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function SourceModal({ source, onClose }: { source: SourceView | null; onClose: () => void }) {
  const run = useRunAction();
  const [name, setName] = useState(source?.name ?? "");
  const [url, setUrl] = useState(source?.url ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onOpenChange={(o) => (o ? undefined : onClose())} title={source ? "Источник новостей" : "Новый источник"} description="Публичная лента RSS или Atom. Адрес обычно оканчивается на rss, feed или xml">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = source ? await run(() => updateNewsSourceAction(source.id, { name, url }), "Источник изменён") : await run(() => addNewsSourceAction({ name, url }), "Источник добавлен");
          setBusy(false);
          if (ok !== null) onClose();
        }}
      >
        <TextInput label="Название" id="news-source-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus />
        <TextInput label="Адрес ленты" id="news-source-url" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="https://" required />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={busy} loading={busy} data-testid="news-source-save">
            {source ? "Сохранить" : "Добавить"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function KeywordsForm({ keywords, directions }: { keywords: Record<string, string[]>; directions: NewsDirection[] }) {
  const run = useRunAction();
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(directions.map((d) => [d.code, (keywords[d.code] ?? []).join(", ")])));
  const [busy, setBusy] = useState(false);
  const changed = directions.some((d) => form[d.code] !== (keywords[d.code] ?? []).join(", "));
  return (
    <form
      className="mt-8 flex flex-col gap-4"
      data-testid="news-keywords"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const saved = await run(() => saveNewsKeywordsAction(form), "Ключевые слова сохранены");
        if (saved) setForm(Object.fromEntries(directions.map((d) => [d.code, (saved[d.code] ?? []).join(", ")])));
        setBusy(false);
      }}
    >
      <div className="max-w-[72ch]">
        <h3 className="text-body font-semibold text-ink">Ключевые слова по продуктам</h3>
        <p className="mt-1 text-small text-muted">
          Через запятую. Слово ловится по началу: «страхов» найдёт «страхование», «страховщик» и «страховой». Пустое поле: к продукту новости не привязываются. Новые слова действуют
          для новостей, которые придут после сохранения.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {directions.map((d) => (
          <TextArea
            key={d.code}
            id={`news-kw-${d.code}`}
            label={d.active ? d.label : `${d.label} (скрыто)`}
            value={form[d.code] ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, [d.code]: e.target.value }))}
            placeholder="слова через запятую"
            rows={3}
            className="[&_textarea]:min-h-0 [&_textarea]:resize-y"
          />
        ))}
      </div>
      <div>
        <Button type="submit" size="sm" variant="secondary" disabled={!changed || busy} loading={busy} data-testid="news-keywords-save">
          Сохранить слова
        </Button>
      </div>
    </form>
  );
}
