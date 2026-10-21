"use client";

// Раздел «Новости» в настройках (этап 60), только владельцу: источники со состоянием последнего забора,
// ключевые слова по продуктам, «Забрать сейчас», состояние уточнения через Claude (без ключа: подключено только
// после удачного вызова, последняя ошибка видна). Удаление источника с подтверждением, у источника признак
// «строгая привязка» для общих деловых лент

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { addNewsSourceAction, fetchNewsNowAction, removeNewsSourceAction, saveNewsKeywordsAction, setNewsSourceActiveAction, updateNewsSourceAction } from "@/app/(app)/news/actions";
import type { ClaudeStatus, ManualFetchState, NewsDirection, SourceView } from "@/lib/news/service";
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
  claude: ClaudeStatus;
  /** «Забрать сейчас»: идёт ли и итог последнего */
  manual: ManualFetchState | null;
};

/** Итог последнего забора вручную человеческим языком */
function manualText(m: ManualFetchState): string {
  if (m.running) return `Забор идёт${m.by ? ` (запустил ${m.by})` : ""}. Обновите страницу через минуту-другую: итог появится здесь и в журнале.`;
  const when = m.finishedAt ? `Забор вручную ${formatDateTime(new Date(m.finishedAt))}: ` : "";
  return `${when}лент ${m.results}, новых новостей ${m.added}, с ошибкой ${m.failed}.${m.postponed ? ` Не успели за 90 секунд: ${m.postponed}, их заберём в следующий час.` : ""}`;
}

/** Состояние уточнения через Claude человеческим языком. Ключ не показывается никогда */
function claudeText(c: ClaudeStatus): string {
  switch (c.state) {
    case "off":
      return "Уточнение через Claude не подключено: привязка к продуктам по ключевым словам, описание это начало анонса источника. Чтобы подключить, задайте на сервере ANTHROPIC_API_KEY (и при желании ANTHROPIC_MODEL).";
    case "pending":
      return `Ключ Claude задан, модель ${c.model}. Удачного вызова ещё не было: проверка пройдёт при ближайшем заборе или по кнопке «Забрать сейчас».`;
    case "on":
      return `Уточнение через Claude подключено, модель ${c.model}, последний удачный вызов ${c.lastOkAt ? formatDateTime(new Date(c.lastOkAt)) : ""}. Модель только сужает продукты, найденные по словам; текст новостей уходит ей как данные, не как инструкции.`;
    case "error":
      return `Уточнение через Claude не работает: ${c.lastError ?? "ошибка"}${c.lastErrorAt ? ` (${formatDateTime(new Date(c.lastErrorAt))})` : ""}. Пока ошибка не уйдёт, привязка и описание по правилам.`;
  }
}

export function NewsSettings({ sources, keywords, directions, lastFetchAt, claude, manual }: NewsSettingsProps) {
  const headingId = useId();
  const run = useRunAction();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<SourceView | "new" | null>(null);
  const [removing, setRemoving] = useState<SourceView | null>(null);
  const withError = sources.filter((s) => s.status === "error");

  const toggle = async (s: SourceView) => {
    setBusy(s.id);
    await run(() => setNewsSourceActiveAction(s.id, !s.active), s.active ? "Источник выключен" : "Источник включён");
    setBusy(null);
  };
  const remove = async (s: SourceView) => {
    setBusy(s.id);
    const ok = await run(() => removeNewsSourceAction(s.id), "Источник удалён");
    setBusy(null);
    if (ok !== null) setRemoving(null);
  };
  const fetchNow = async () => {
    setBusy("fetch");
    const r = await run(() => fetchNewsNowAction(), "Забор запущен");
    setBusy(null);
    if (r) router.refresh();
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
        <p className={claude.state === "error" ? "mt-1 text-small text-danger-ink" : "mt-1 text-small text-muted"} data-testid="news-claude">
          {claudeText(claude)}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => void fetchNow()} disabled={busy === "fetch" || !!manual?.running} loading={busy === "fetch"} data-testid="news-fetch-now">
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
      {manual ? (
        <p className="mt-2 text-small text-muted" data-testid="news-fetch-report" data-running={manual.running ? "yes" : "no"}>
          {manualText(manual)}
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
                {s.strict ? <Badge tone="outline">Два признака продукта</Badge> : null}
              </div>
              <p className="text-caption text-muted [overflow-wrap:anywhere]">{s.url}</p>
              <p className="text-caption text-muted">
                {s.lastFetchAt ? `Забор ${formatDateTime(new Date(s.lastFetchAt))}` : "Забора ещё не было"}
                {s.lastOkAt ? `, в ленте записей ${s.lastCount}` : ""}, новостей сохранено {s.items}
              </p>
              {s.lastError ? (
                <p className="text-caption text-danger-ink" data-testid="news-source-error">
                  Ошибка: {s.lastError}
                  {s.failCount > 1 ? ` (подряд ${s.failCount}, опрашиваем реже)` : ""}
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
              <Button type="button" variant="ghost" size="sm" onClick={() => setRemoving(s)} disabled={busy === s.id} aria-label={`Удалить источник ${s.name}`} data-testid="news-source-remove">
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

      <Modal
        open={!!removing}
        onOpenChange={(o) => (o || busy ? undefined : setRemoving(null))}
        title="Удалить источник?"
        description={removing ? `«${removing.name}» уйдёт из списка вместе с сохранёнными новостями (${removing.items}). Если лента временно не работает, лучше выключить её.` : undefined}
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => setRemoving(null)} disabled={!!busy}>
            Отмена
          </Button>
          {removing?.active ? (
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                const s = removing;
                setRemoving(null);
                await toggle(s);
              }}
              disabled={!!busy}
            >
              Выключить
            </Button>
          ) : null}
          <Button type="button" variant="danger" onClick={() => (removing ? void remove(removing) : undefined)} disabled={!!busy} loading={!!removing && busy === removing.id} data-testid="news-source-remove-confirm">
            Удалить
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function SourceModal({ source, onClose }: { source: SourceView | null; onClose: () => void }) {
  const run = useRunAction();
  const [name, setName] = useState(source?.name ?? "");
  const [url, setUrl] = useState(source?.url ?? "");
  const [strict, setStrict] = useState(source?.strict ?? false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onOpenChange={(o) => (o ? undefined : onClose())} title={source ? "Источник новостей" : "Новый источник"} description="Публичная лента RSS или Atom. Адрес обычно оканчивается на rss, feed или xml. Только http и https, стандартные порты, без внутренних адресов">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = source ? await run(() => updateNewsSourceAction(source.id, { name, url, strict }), "Источник изменён") : await run(() => addNewsSourceAction({ name, url, strict }), "Источник добавлен");
          setBusy(false);
          if (ok !== null) onClose();
        }}
      >
        <TextInput label="Название" id="news-source-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus />
        <TextInput label="Адрес ленты" id="news-source-url" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="https://" required />
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} className="mt-1 h-4 w-4 accent-blue-700" data-testid="news-source-strict" />
          <span className="text-body text-ink">
            Строгая привязка
            <span className="block text-small text-muted">Для общих деловых лент (Интерфакс, ТАСС, РБК): новость попадает в продукт, только если в ней два разных слова этого продукта.</span>
          </span>
        </label>
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
          Через запятую. Слово ловится по началу: «страхов» найдёт «страхование», «страховщик» и «страховой»; в словосочетании каждое слово тоже по началу. Слово в кавычках
          ищется целиком: &quot;Сравни&quot; найдёт «Сравни.ру», но не «сравнил». Пустое поле: к продукту новости не привязываются. Новые слова действуют для новостей, которые
          придут после сохранения.
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
