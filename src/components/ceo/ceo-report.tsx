"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCopy, Columns2, Mail, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { numbersText, type WeekNumbers } from "@/lib/numbers/text";
import { forecastText } from "@/lib/forecast/codes";
import type { ForecastSummary } from "@/lib/forecast/types";
import { ForecastSummaryBlock, WeekNumbersBlock } from "@/components/forecast/week-numbers";
import { planBriefText, type PlanBrief } from "@/lib/plan/brief";
import { PlanBriefBlock } from "@/components/plan/plan-brief";
import { Figures } from "@/components/ui/data";
import { directionLabel } from "@/domain/dictionaries";
import { formatLong, formatShort, plural } from "@/domain/dates";
import type { PersonSlug, WeekView } from "@/domain/types";
import { compactName } from "@/domain/people";
import { promiseShare, summaryText, type PromiseSummary } from "@/lib/weekly/promises";
import type { PromiseHistory } from "@/lib/weekly/promise-service";
import { buildCeoSections, cleanDash, type CeoSections } from "@/lib/weekly/rules";
import type { CeoDecision, CeoReportView } from "@/lib/weekly/service";
import { MAIL_PASTE_HINT, MEETINGS_MAX, MEETING_TEXT_MAX, MEETING_TITLE_MAX, ceoReportText, cleanMeetings, countSentences, mailtoHref, type CeoMeeting } from "@/lib/ceo/text";
import { saveCeoReportAction } from "@/app/(app)/weekly/actions";
import { Button, buttonClass } from "@/components/ui/button";
import { TextArea, TextInput } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { WeekSwitcher } from "@/components/weekly/weekly-feed";
import { useRunWeekly } from "@/components/weekly/use-weekly";

type Promises = { people: { slug: PersonSlug; summary: PromiseSummary }[]; total: PromiseSummary; snapshotAt?: string };

/** «За 8 недель: 64%» или «статистика появится через 6 недель» */
function statsLine(h: PromiseHistory | undefined): string | null {
  if (!h) return null;
  if (!h.enabled) return `за 8 недель: появится после 6 недель с обещаниями, сейчас ${h.active}`;
  const share = promiseShare(h.total);
  return share === null ? null : `за 8 недель: ${share}%`;
}

/** «Сделано 7 из 10 (70%). Снято 1» */
function promiseLine(s: PromiseSummary): string {
  const share = promiseShare(s);
  const text = summaryText(s);
  return share === null ? text : text.replace(/^(Сделано \d+ из \d+)/, `$1 (${share}%)`);
}

type History = { key: string; number: number; flagged: number; meeting: string; savedBy?: string; savedAt?: string }[];

// В строке отчёта продукт, а не человек: CEO читает по продуктам (07.10)
const fromEntries = (view: WeekView) => buildCeoSections(view.entries, directionLabel);

function moment(iso: string): string {
  const at = new Date(iso);
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(at);
}

type Draft = CeoMeeting & { key: number };
let draftKey = 0;
const withKey = (m: CeoMeeting): Draft => ({ ...m, key: ++draftKey });

/** Текст прошлой недели под полем: только при сравнении */
function Previous({ number, text }: { number: number; text: string | undefined }) {
  return (
    <div className="rounded-lg bg-field px-3.5 py-2.5">
      <p className="text-caption font-medium text-muted">Неделя {number}</p>
      <p className="mt-1 whitespace-pre-wrap text-small text-ink">{text?.trim() ? text : <span className="text-muted">Раздел был пустым</span>}</p>
    </div>
  );
}

/** Черновик отчёта CEO (раздел 3 ТЗ, этап 27): видят только владелец и администраторы, в таблицу он не выгружается */
export function CeoReport({
  view,
  saved,
  history,
  promises,
  stats,
  numbers,
  forecast,
  plan,
  decisions = [],
  previous,
  owner = false,
}: {
  view: WeekView;
  saved: CeoReportView;
  history: History;
  promises?: Promises;
  /** Личная статистика за 8 недель: только директору */
  stats?: PromiseHistory[];
  /** Цифры недели из недельного отчёта и прогноз лидеров (этап 24) */
  numbers?: WeekNumbers;
  forecast?: ForecastSummary;
  /** Прогноз месяца по драйверам из LRF (этап 35) */
  plan?: PlanBrief | null;
  /** Решения топ-команды по этой неделе (этап 27) */
  decisions?: CeoDecision[];
  /** Отчёт прошлой недели для сравнения (этап 27) */
  previous?: { number: number; report: CeoReportView };
  owner?: boolean;
}) {
  const thanks = useMemo(() => view.reports.filter((r) => r.thanks), [view.reports]);
  const { notify } = usePrototype();
  const run = useRunWeekly();
  const router = useRouter();
  const week = view.week;
  const flaggedCount = view.entries.filter((e) => e.ceo).length;
  const [sections, setSections] = useState<CeoSections>(() => saved.sections ?? fromEntries(view));
  // У встречи на экране свой ключ: при удалении поля не перескакивают
  const [meetings, setMeetings] = useState<Draft[]>(() => saved.meetings.map(withKey));
  const [dirty, setDirty] = useState(!saved.sections);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [compare, setCompare] = useState(false);
  // Момент последнего сохранения, который видел экран: сервер сверяет его, чтобы не затереть чужие правки
  const [savedAt, setSavedAt] = useState<{ at: string | null; by?: string }>({ at: saved.updatedAt ?? null, by: saved.updatedBy });
  const savedAtRef = useRef<string | null>(saved.updatedAt ?? null);
  // Счётчик правок: правки во время сохранения не помечаются сохранёнными, свежая версия с сервера не затирает набранное
  const rev = useRef(0);
  const syncedRev = useRef(0);
  const markDirty = () => {
    rev.current += 1;
    setDirty(true);
  };
  /** Сохранённая версия с другого устройства или от другого человека пришла, пока здесь есть несохранённые правки */
  const [newer, setNewer] = useState<CeoReportView | null>(null);
  const set = (key: keyof CeoSections, value: string) => {
    setSections((s) => ({ ...s, [key]: cleanDash(value) }));
    markDirty();
  };
  const setMeeting = (i: number, patch: Partial<Draft>) => {
    setMeetings((list) => list.map((m, j) => (j === i ? { ...m, ...patch } : m)));
    markDirty();
  };

  const adopt = (r: CeoReportView) => {
    setSections(r.sections ?? fromEntries(view));
    setMeetings(r.meetings.map(withKey));
    savedAtRef.current = r.updatedAt ?? null;
    setSavedAt({ at: r.updatedAt ?? null, by: r.updatedBy });
    syncedRev.current = rev.current;
    setDirty(!r.sections);
    setNewer(null);
  };

  // Страница обновляется сама (раз в минуту и при возвращении на вкладку). Новая сохранённая версия: без своих правок
  // берём её, со своими правками показываем предупреждение, набранное не пропадает
  const seen = useRef(saved.updatedAt ?? null);
  useEffect(() => {
    const at = saved.updatedAt ?? null;
    if (at === seen.current) return;
    seen.current = at;
    if (at === savedAtRef.current) return;
    if (rev.current === syncedRev.current) adopt(saved);
    else setNewer(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const fullText = useMemo(
    () =>
      ceoReportText({
        weekNumber: week.number,
        numbers: numbers ? numbersText(numbers) : ["Появятся после подключения недельного отчёта."],
        forecast: forecast ? forecastText(forecast) : undefined,
        monthPlan: plan ? planBriefText(plan) : undefined,
        promises: promises?.total.total ? promiseLine(promises.total) : undefined,
        main: sections.main,
        decisions,
        risks: sections.risks,
        next: sections.next,
        thanks: thanks.map((r) => ({ name: compactName(r.author), text: r.thanks! })),
        meetings: cleanMeetings(meetings),
      }),
    [week.number, numbers, forecast, plan, promises, sections, decisions, thanks, meetings],
  );

  const copy = async (okText = "Текст отчёта скопирован") => {
    try {
      await navigator.clipboard.writeText(fullText);
      notify(okText);
      return true;
    } catch {
      notify("Не получилось скопировать: выделите текст вручную", "error");
      return false;
    }
  };

  const subject = `Отчёт за неделю ${week.number}`;
  // Черновик письма обычной ссылкой: почтовая программа открывается сама. Длинный текст в адрес письма не влезает:
  // тогда по нажатию он уходит в буфер обмена, а письмо открывается с темой и подсказкой вставить текст
  const fullHref = mailtoHref(subject, fullText);
  const mailHref = fullHref ?? mailtoHref(subject, MAIL_PASTE_HINT) ?? "mailto:";

  const save = async () => {
    const startRev = rev.current;
    setBusy(true);
    const result = await run(() => saveCeoReportAction(week.key, sections, cleanMeetings(meetings), savedAtRef.current), `Отчёт за неделю ${week.number} сохранён`);
    setBusy(false);
    // Не сохранилось (например, отчёт уже сохранили в другом месте): подтягиваем свежую версию, чтобы сразу
    // появилось предупреждение с кнопкой «Показать сохранённую версию». Набранное при этом не пропадает
    if (!result) router.refresh();
    if (result) {
      savedAtRef.current = result.updatedAt ?? null;
      setSavedAt({ at: result.updatedAt ?? null, by: result.updatedBy });
      setNewer(null);
      // Пока шло сохранение, правили дальше: эти правки ещё не на сервере
      if (rev.current === startRev) {
        syncedRev.current = startRev;
        setDirty(false);
      }
    }
  };

  const rebuild = () => {
    setSections(fromEntries(view));
    markDirty();
    setConfirm(false);
    notify("Главное, риски и что дальше собраны заново из отмеченных записей");
  };

  const prev = previous?.report;
  const sentences = (text: string) => {
    const n = countSentences(text);
    return `${n} ${plural(n, "предложение", "предложения", "предложений")}`;
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-6">
        {/* Этап 37: из чего собран отчёт, в цифрах */}
        <Figures
          label="Отчёт в цифрах"
          items={[
            { label: "Отметок «В отчёт CEO»", value: flaggedCount, href: `/weekly?week=${week.key}`, testId: "ceo-fig-flags" },
            { label: "Решений недели", value: decisions?.length ?? 0, testId: "ceo-fig-decisions" },
            {
              label: "Обещания выполнены",
              // Все обещания сняты: доли нет, а не ноль процентов
              value: promises?.total.total && promiseShare(promises.total) !== null ? `${promiseShare(promises.total)}%` : "нет",
              testId: "ceo-fig-promises",
            },
            { label: "Благодарностей", value: thanks.length, testId: "ceo-fig-thanks" },
            { label: "Моих встреч", value: cleanMeetings(meetings).length, testId: "ceo-fig-meetings" },
          ]}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <WeekSwitcher view={view} basePath="/ceo-report" />
          <p className="text-small text-muted" aria-live="polite">
            {dirty ? "Есть несохранённые правки" : savedAt.at ? `Сохранён ${moment(savedAt.at)}${savedAt.by ? `, ${savedAt.by}` : ""}` : ""}
          </p>
        </div>

        <div className="flex flex-col gap-3 sv-card sv-card--soft px-5 py-4">
          <p className="text-body text-ink">
            {flaggedCount ? `Записей с отметкой «В отчёт CEO»: ${flaggedCount}.` : "Отметок «В отчёт CEO» за эту неделю нет."} Отметки ставятся в{" "}
            <Link href={`/weekly?week=${week.key}`} className="font-medium text-blue-700 hover:underline">
              ленте weekly
            </Link>
            .
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setConfirm(true)}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Собрать заново
            </Button>
            {previous ? (
              <Button size="sm" variant="secondary" onClick={() => setCompare((c) => !c)}>
                <Columns2 className="h-4 w-4" aria-hidden="true" />
                {compare ? "Скрыть прошлую неделю" : "Сравнить с прошлой неделей"}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
              Скопировать текст
            </Button>
            <a
              href={mailHref}
              className={buttonClass("secondary", "sm")}
              onClick={(e) => {
                if (fullHref) return;
                // Письмо с подсказкой «вставьте текст» открываем только после того, как текст правда в буфере
                e.preventDefault();
                void copy("Текст длинный: он скопирован, вставьте его в письмо").then((ok) => {
                  if (ok) window.location.href = mailHref;
                });
              }}
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              Открыть письмом
            </a>
            <Button size="sm" onClick={save} disabled={busy || !dirty}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {busy ? "Сохраняю…" : "Сохранить"}
            </Button>
          </div>
          {newer ? (
            <div className="flex flex-col gap-2 rounded-lg bg-warning-soft px-3.5 py-2.5 text-small text-warning-ink sm:flex-row sm:items-center sm:justify-between" role="status">
              <p>
                Отчёт за эту неделю сохранён на другом устройстве или другим человеком{newer.updatedBy ? ` (${newer.updatedBy})` : ""}. Ваши правки ещё не сохранены: скопируйте их, если они нужны.
              </p>
              <Button size="sm" variant="secondary" className="shrink-0" onClick={() => adopt(newer)}>
                Показать сохранённую версию
              </Button>
            </div>
          ) : null}
          {compare && previous && !prev?.sections ? (
            <p className="text-small text-muted">Отчёт за неделю {previous.number} не сохраняли: сравнивать не с чем.</p>
          ) : null}
        </div>

        {numbers ? (
          <WeekNumbersBlock numbers={numbers} manage={owner} />
        ) : (
          <section aria-labelledby="ceo-numbers" className="sv-card sv-card--soft border border-dashed border-line px-5 py-4">
            <h2 id="ceo-numbers" className="text-title-sm font-semibold text-ink">Цифры недели</h2>
            <p className="mt-1 text-body text-muted">Появятся после подключения недельного отчёта. Руками факт никто не вводит.</p>
          </section>
        )}
        {plan ? <PlanBriefBlock brief={plan} /> : null}
        {forecast ? <ForecastSummaryBlock summary={forecast} /> : null}

        <section aria-labelledby="ceo-promises" className="sv-card sv-card--soft px-5 py-4">
          <h2 id="ceo-promises" className="text-title-sm font-semibold text-ink">Обещания недели</h2>
          {promises?.total.total ? (
            <>
              <p className="mt-1 text-body text-ink">{promiseLine(promises.total)}</p>
              <ul className="mt-3 flex flex-col gap-1">
                {promises.people.map((p) => {
                  const longer = statsLine(stats?.find((h) => h.slug === p.slug));
                  return (
                    <li key={p.slug} className="flex flex-col text-small sm:flex-row sm:gap-2">
                      <span className="font-medium text-ink sm:w-40 sm:shrink-0">{compactName(p.slug)}</span>
                      <span className="text-muted">
                        {promiseLine(p.summary)}
                        {longer ? `. ${longer.charAt(0).toUpperCase()}${longer.slice(1)}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {promises.snapshotAt ? <p className="mt-3 text-caption text-muted">Снимок на момент закрытия недели, {moment(promises.snapshotAt)}: правки задач после закрытия его не меняют.</p> : null}
              <p className="mt-3 text-caption text-muted">
                Планы из прошлого weekly и задачи со сроком на этой неделе. Итог плана ставит лидер при сдаче weekly, итог задачи это её статус. Доля считается от обещаний с итогом, снятые не считаются.
              </p>
            </>
          ) : (
            <p className="mt-1 text-body text-muted">Обещаний на эту неделю не было: в прошлом weekly нет планов, задач со сроком на неделе нет.</p>
          )}
        </section>

        <div className="flex flex-col gap-2">
          <TextArea label="Главное за неделю" id="ceo-main" value={sections.main} onChange={(e) => set("main", e.target.value)} rows={6} hint="Пишите от первого лица. Длинное тире и стрелки заменяются на дефис сами" />
          {compare && prev?.sections ? <Previous number={previous!.number} text={prev.sections.main} /> : null}
        </div>

        <section aria-labelledby="ceo-decisions" className="sv-card sv-card--soft px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ceo-decisions" className="text-title-sm font-semibold text-ink">
              Решения недели
            </h2>
            <Link href="/decisions" className="text-small font-medium text-link hover:underline">
              Журнал решений
            </Link>
          </div>
          {decisions.length ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {decisions.map((d) => (
                <li key={d.id} className="text-small text-ink">
                  {d.text}
                  <span className="text-muted">
                    {d.owner ? `. Владелец: ${d.owner}` : ""}, {formatShort(d.date)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-body text-muted">Решений топ-команды по этой неделе в журнале нет. Они появятся здесь сами, когда их запишут на встрече.</p>
          )}
        </section>

        <div className="flex flex-col gap-2">
          <TextArea label="Риски" id="ceo-risks" value={sections.risks} onChange={(e) => set("risks", e.target.value)} rows={4} />
          {compare && prev?.sections ? <Previous number={previous!.number} text={prev.sections.risks} /> : null}
        </div>
        <div className="flex flex-col gap-2">
          <TextArea label="Что дальше" id="ceo-next" value={sections.next} onChange={(e) => set("next", e.target.value)} rows={4} />
          {compare && prev?.sections ? <Previous number={previous!.number} text={prev.sections.next} /> : null}
        </div>

        {thanks.length ? (
          <section aria-labelledby="ceo-thanks" className="sv-card sv-card--soft px-5 py-4">
            <h2 id="ceo-thanks" className="text-title-sm font-semibold text-ink">Благодарности</h2>
            <ul className="mt-2 flex flex-col gap-1">
              {thanks.map((r) => (
                <li key={r.author} className="flex flex-col text-small sm:flex-row sm:gap-2">
                  <span className="font-medium text-ink sm:w-40 sm:shrink-0">{compactName(r.author)}</span>
                  <span className="text-ink">{r.thanks}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="ceo-meetings" className="flex flex-col gap-3">
          <div>
            <h2 id="ceo-meetings" className="text-title-sm font-semibold text-ink">
              Мои встречи недели
            </h2>
            <p className="mt-1 text-small text-muted">По 4-5 предложений на встречу от первого лица: с кем, о чём договорились, что важно знать CEO.</p>
          </div>
          {meetings.map((m, i) => (
            <div key={m.key} className="flex flex-col gap-3 sv-card sv-card--soft px-5 py-4">
              <div className="flex items-end gap-3">
                <TextInput
                  className="min-w-0 flex-1"
                  label={`Встреча ${i + 1}: с кем и о чём`}
                  id={`ceo-meeting-${i}-title`}
                  value={m.title}
                  maxLength={MEETING_TITLE_MAX}
                  onChange={(e) => setMeeting(i, { title: cleanDash(e.target.value) })}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Убрать встречу ${i + 1}`}
                  onClick={() => {
                    setMeetings((list) => list.filter((_, j) => j !== i));
                    markDirty();
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Убрать
                </Button>
              </div>
              <TextArea
                label={`Встреча ${i + 1}: что важно`}
                id={`ceo-meeting-${i}-text`}
                value={m.text}
                rows={4}
                maxLength={MEETING_TEXT_MAX}
                onChange={(e) => setMeeting(i, { text: cleanDash(e.target.value) })}
                hint={m.text.trim() ? `${sentences(m.text)}. Хорошо, когда их 4-5` : "Например: «С партнёрами обсуждали условия на ноябрь и договорились о скидке»"}
              />
            </div>
          ))}
          {meetings.length < MEETINGS_MAX ? (
            <div>
              <Button
                size="sm"
                variant="soft"
                onClick={() => {
                  setMeetings((list) => [...list, withKey({ title: "", text: "" })]);
                  markDirty();
                }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Добавить встречу
              </Button>
            </div>
          ) : null}
          {compare && prev?.sections ? (
            <div className="rounded-lg bg-field px-3.5 py-2.5">
              <p className="text-caption font-medium text-muted">Неделя {previous!.number}</p>
              {prev.meetings.length ? (
                <ul className="mt-1 flex flex-col gap-2">
                  {prev.meetings.map((m, i) => (
                    <li key={i} className="text-small text-ink">
                      <span className="font-medium">{m.title || "Встреча"}</span>
                      <span className="block whitespace-pre-wrap">{m.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-small text-muted">Встреч не записывали</p>
              )}
            </div>
          ) : null}
        </section>
      </div>

      <aside aria-labelledby="ceo-history">
        <h2 id="ceo-history" className="mb-3 text-title-sm font-semibold text-ink">История отчётов</h2>
        {history.length === 0 ? (
          <p className="text-small text-muted">Пока ни одного отчёта.</p>
        ) : (
          <ul className="divide-y divide-line sv-card sv-card--soft">
            {history.map((h) => (
              <li key={h.key}>
                <Link href={`/ceo-report?week=${h.key}`} aria-current={h.key === week.key ? "page" : undefined} className="block px-4 py-3 hover:bg-field aria-[current=page]:bg-field">
                  <p className="text-body font-medium text-ink">Неделя {h.number}</p>
                  <p className="text-caption text-muted">
                    {h.savedAt ? `Сохранён ${moment(h.savedAt)}${h.savedBy ? `, ${h.savedBy}` : ""}` : "Не сохранялся"}. Отметок: {h.flagged}, встреча {h.meeting}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-caption text-muted">Отчёт видят только владелец и администраторы. В Google-таблицу он не выгружается. Встреча недели {week.number}: {formatLong(week.meetingDate)}.</p>
      </aside>

      <Modal open={confirm} onOpenChange={setConfirm} title="Собрать отчёт заново?" description="Главное, риски и что дальше соберутся заново из записей с отметкой «В отчёт CEO». Ваши правки в этих трёх разделах пропадут. Встречи недели останутся как есть.">
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Отмена
          </Button>
          <Button variant="dark" onClick={rebuild}>
            Собрать заново
          </Button>
        </div>
      </Modal>
    </div>
  );
}
