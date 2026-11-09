"use client";

// Переключатель команды в шапке (этап 14). Выбор виден, если команд больше одной; при одной команде или без команд
// на его месте ссылка на экран «Weekly-команды» (этап 64), чтобы управлять командами можно было отовсюду.
// Список и weekly показывают выбранную команду, «Мои задачи» и «Моя неделя» собирают свои задачи из всех команд.
// Вид по дизайн-системе (navigation/TeamSwitcher.jsx): кнопка с иконкой людей, названием, ролью и стрелкой.
//
// Этап 74 (просьба Арама 23.10.2026: «выпадающий список с департаментами очень неудобный, нужна строка поиска»):
// вместо системного списка на десятки и сотни команд окно выбора со строкой поиска по названию и руководителю.
// Сверху «Ваши команды» и «Недавние», дальше все команды по дереву; у каждой второй строкой руководитель, по нему
// различают одноимённые команды разных руководителей. Стрелки ходят по списку, Enter выбирает, Escape закрывает,
// фокус возвращается на кнопку. На телефоне окно на весь экран. Последний пункт «Управлять командами» ведёт на экран
// «Weekly-команды» и команду не меняет (этап 64).
//
// Права тут не считаются: в окно попадают только команды из team.options, то есть те, что человек уже может выбрать,
// и сервер проверяет выбор ещё раз (setTeamAction). Поиск к этому списку ничего не добавляет.

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, CornerDownLeft, Search, Settings2, Users, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { ALL_TEAMS } from "@/domain/teams";

import { matchTeam, readRecent, rememberRecent, teamHint, teamSections, type TeamPick } from "@/domain/team-picker";
import { setTeamAction } from "@/app/actions/team";
import { cn } from "@/lib/cn";
import { useRegistry, withRegistryLabels } from "@/domain/registry-context";

/** Пункт окна: команда или «Все мои команды». key уникален в окне: одна команда бывает и в «Ваших», и в «Недавних» */
type Row = { key: string; id: string; name: string; hint: string; depth: number; note: string | null; index: number };

const ALL_ROW = { id: ALL_TEAMS, name: "Все мои команды", hint: "Задачи и weekly всех команд из списка вместе" };

export const TeamSwitcher = withRegistryLabels(function TeamSwitcher({ compact = false }: { compact?: boolean }) {
  const { teamOf, personOf } = useRegistry();
  const { team, notify, me, viewing, ownerAs } = usePrototype();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Руководитель и команда выше берутся из снимка справочников. Команду выше называем только тогда, когда она сама
  // видна человеку: иначе окно выбора назвало бы команду, которой человек не видит
  const picks = useMemo<TeamPick[]>(() => {
    const visible = new Set(team.options.map((o) => o.id));
    return team.options.map((o) => {
      const entry = teamOf(o.id);
      const parent = entry?.parent && visible.has(entry.parent) ? (teamOf(entry.parent)?.name ?? null) : null;
      return { ...o, leader: entry?.leader ? personOf(entry.leader).fullName : null, parent };
    });
  }, [team.options, teamOf, personOf]);

  const sections = useMemo(() => {
    const rowOf = (section: string, t: TeamPick, indent: boolean): Omit<Row, "index"> => ({
      key: `${section}:${t.id}`,
      id: t.id,
      name: t.name,
      hint: teamHint(t.leader, t.parent),
      // Отступ по дереву только в «Все команды»: в «Ваших» и «Недавних» дерева нет, там отступ сбивал бы с толку
      depth: indent ? Math.min(t.depth, 4) : 0,
      note: t.relation === "leader" ? "вы руководитель" : t.relation === "member" ? "вы участник" : null,
    });
    const allRow: Omit<Row, "index"> = { key: "all:*", ...ALL_ROW, depth: 0, note: null };
    const filled = teamSections(picks, recent, query)
      .map((s) => {
        const own = s.items.map((t) => rowOf(s.key, t, s.key === "all"));
        // «Все мои команды» первым пунктом раздела всех команд, а в поиске — если запрос подходит к её названию
        const withAll = s.key === "all" ? [allRow, ...own] : s.key === "found" && matchTeam({ name: allRow.name, leader: null }, query) ? [...own, allRow] : own;
        return { key: s.key, title: s.title, items: withAll };
      })
      .filter((s) => s.items.length > 0);
    // Сквозной номер пункта: по нему стрелки ходят через все разделы подряд, поэтому у раздела свой сдвиг
    const offsets = filled.map((_, i) => filled.slice(0, i).reduce((sum, s) => sum + s.items.length, 0));
    return filled.map((s, i) => ({ key: s.key, title: s.title, rows: s.items.map((r, j) => ({ ...r, index: offsets[i]! + j })) }));
  }, [picks, recent, query]);
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  if (team.options.length <= 1) {
    const only = team.options[0]?.name ?? null;
    return (
      <div className={cn("sv-team-switch min-w-0", compact && "sv-team-switch--compact flex-1")}>
        <Link href="/people/teams" className="sv-team-switch__trigger max-w-full" aria-label={only ? `${only}: управлять командами` : "Управлять командами"} title="Управлять командами" data-testid={compact ? "team-manage-link-m" : "team-manage-link"}>
          {!compact ? <Users className="h-[18px] w-[18px] shrink-0 text-text-secondary" strokeWidth={1.5} aria-hidden="true" /> : null}
          <span className="sv-team-switch__name">{only ?? "Weekly-команды"}</span>
        </Link>
      </div>
    );
  }

  const id = compact ? "team-switcher-m" : "team-switcher";
  const current = team.options.find((o) => o.id === team.id);
  const name = team.id === ALL_TEAMS ? ALL_ROW.name : (current?.name ?? team.name);
  const lead = current?.relation === "leader";
  const listId = `${id}-list`;
  const activeRow = rows[cursor];

  const onOpenChange = (next: boolean) => {
    // «Недавние» читаются при каждом открытии: команду могли сменить в другой вкладке того же браузера
    if (next) {
      setRecent(viewing || ownerAs ? [] : readRecent(me.slug));
      setQuery("");
      setCursor(0);
    }
    setOpen(next);
  };

  const choose = (row: Row) => {
    setOpen(false);
    if (row.id === team.id) return;
    // Свои команды и так сверху, в «Недавних» они не нужны. В просмотре «Смотреть как» и во входе владельца в чужой
    // профиль устройство владельца чужими «Недавними» не засоряем
    const own = team.options.some((o) => o.id === row.id && (o.relation === "leader" || o.relation === "member"));
    if (row.id !== ALL_TEAMS && !own && !viewing && !ownerAs) setRecent(rememberRecent(me.slug, row.id));
    start(async () => {
      const r = await setTeamAction(row.id);
      if (!r.ok) notify(r.error, "error");
      router.refresh();
    });
  };

  const move = (to: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, to));
    setCursor(next);
    // Пункт под стрелкой всегда виден: номера пунктов при ходьбе не меняются, поэтому нужный уже есть в разметке
    listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(cursor + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(cursor - 1);
    } else if (e.key === "Home" && !query) {
      e.preventDefault();
      move(0);
    } else if (e.key === "End" && !query) {
      e.preventDefault();
      move(rows.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeRow) choose(activeRow);
    }
  };

  return (
    <div className={cn("sv-team-switch min-w-0", compact && "sv-team-switch--compact flex-1")}>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            id={id}
            data-testid={id}
            data-team={team.id ?? ""}
            aria-haspopup="dialog"
            // Пока команда переключается, кнопка заперта: иначе на медленной сети человек выберет вторую команду,
            // уйдут два setTeamAction, и какая окажется в cookie, зависит от порядка ответов
            disabled={pending}
            aria-busy={pending}
            aria-label={`Команда: ${name}. Сменить команду`}
            className={cn("sv-team-switch__trigger max-w-full", open && "is-open", pending && "opacity-60")}
          >
            {!compact ? <Users className="h-[18px] w-[18px] shrink-0 text-text-secondary" strokeWidth={1.5} aria-hidden="true" /> : null}
            <span className="sv-team-switch__name">{name}</span>
            {lead && !compact ? <span className="sv-team-switch__role">руководитель</span> : null}
            <ChevronDown className="h-[18px] w-[18px] shrink-0 text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
          <Dialog.Content
            data-testid="team-picker"
            // Фокус сразу в строке поиска, а не на кнопке «Закрыть»: команду ищут, а не листают
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              inputRef.current?.focus();
            }}
            className="fixed inset-0 z-50 flex flex-col bg-surface outline-none sm:inset-auto sm:left-1/2 sm:top-[10vh] sm:max-h-[76vh] sm:w-[calc(100%-32px)] sm:max-w-[560px] sm:-translate-x-1/2 sm:rounded-panel sm:border sm:border-line sm:shadow-medium"
          >
            <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))] sm:px-5 sm:pt-4">
              <Dialog.Title className="sv-modal__title m-0">Выбор команды</Dialog.Title>
              <Dialog.Close className="sv-icon-btn sv-icon-btn--sm shrink-0" aria-label="Закрыть">
                <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Найдите команду по названию или руководителю. Стрелки ходят по списку, Enter выбирает, Escape закрывает</Dialog.Description>
            <div className="relative mx-4 sm:mx-5">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                ref={inputRef}
                id={`${id}-search`}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={activeRow ? `${id}-opt-${activeRow.key}` : undefined}
                aria-autocomplete="list"
                aria-label="Поиск команды по названию или руководителю"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                  listRef.current?.scrollTo({ top: 0 });
                }}
                onKeyDown={onKeyDown}
                placeholder="Название команды или руководитель"
                className="sv-control h-12 w-full pl-10 pr-3 text-body"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="go"
              />
            </div>
            <ul ref={listRef} id={listId} role="listbox" aria-label="Команды" className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 sm:px-3">
              {sections.map((s) => (
                <li key={s.key} role="presentation">
                  <p className="sv-cmdk__group" id={`${id}-group-${s.key}`}>
                    {s.title}
                  </p>
                  <ul role="group" aria-labelledby={`${id}-group-${s.key}`}>
                    {s.rows.map((row) => {
                      const i = row.index;
                      const selected = row.id === team.id;
                      return (
                        <li
                          key={row.key}
                          id={`${id}-opt-${row.key}`}
                          role="option"
                          aria-selected={i === cursor}
                          data-index={i}
                          data-team={row.id}
                          onMouseMove={() => i !== cursor && setCursor(i)}
                          onClick={() => choose(row)}
                          className={cn("sv-cmdk__item !items-start", i === cursor && "is-active")}
                          style={row.depth ? { paddingLeft: `${10 + row.depth * 16}px` } : undefined}
                        >
                          <span className="min-w-0 flex-1">
                            <span className={cn("block text-body text-ink", selected && "font-semibold")}>
                              {row.name}
                              {selected ? <span className="sr-only">, выбрана сейчас</span> : null}
                            </span>
                            <span className="block text-small text-muted">{row.hint}</span>
                          </span>
                          {row.note ? <span className="mt-0.5 hidden shrink-0 text-caption text-muted sm:inline">{row.note}</span> : null}
                          {selected ? <Check className="mt-0.5 h-[18px] w-[18px] shrink-0 text-link" strokeWidth={1.75} aria-hidden="true" /> : null}
                          {i === cursor && !selected ? <CornerDownLeft className="mt-1 hidden h-4 w-4 shrink-0 text-muted sm:block" aria-hidden="true" /> : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
              {!rows.length ? <li className="px-3 py-4 text-small text-muted">Команды «{query.trim()}» нет: проверьте написание или поищите по фамилии руководителя</li> : null}
            </ul>
            {/* Сколько нашлось: экранный диктор читает это при вводе */}
            <span className="sr-only" aria-live="polite">
              {query.trim() ? (rows.length ? `Найдено: ${rows.length}` : "Ничего не нашлось") : ""}
            </span>
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 pb-[max(8px,env(safe-area-inset-bottom))] sm:px-5">
              <Link href="/people/teams" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center gap-2 text-body font-medium text-link hover:underline" data-testid={`${id}-manage`}>
                <Settings2 className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden="true" />
                Управлять командами
              </Link>
              <span className="hidden items-center gap-3 text-caption text-text-secondary sm:inline-flex">
                <span className="inline-flex items-center gap-1.5">
                  <kbd className="sv-kbd">↑↓</kbd> выбрать
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <kbd className="sv-kbd">Enter</kbd> открыть
                </span>
              </span>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
});
