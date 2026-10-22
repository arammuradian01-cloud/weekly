"use client";

// Переключатель команды в шапке (этап 14). Список виден, если команд больше одной; при одной команде или без команд
// на его месте ссылка на экран «Weekly-команды» (этап 64), чтобы управлять командами можно было отовсюду.
// Список и weekly показывают выбранную команду, «Мои задачи» и «Моя неделя» собирают свои задачи из всех команд.
// Вид по дизайн-системе (navigation/TeamSwitcher.jsx): кнопка с иконкой людей, названием, ролью и стрелкой.
// Этап 74 (просьба Арама 23.10.2026): вместо системного списка на десятки команд окно выбора со строкой поиска по
// названию и руководителю. Сверху «Ваши команды» и «Недавние», дальше все команды по структуре. Стрелки ходят по
// списку, Enter выбирает, Escape закрывает, фокус возвращается на кнопку. На телефоне окно на весь экран.

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, CornerDownLeft, Search, Settings2, Users, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { ALL_TEAMS, teamOf } from "@/domain/teams";
import { personOf } from "@/domain/people";
import { matchTeam, readRecent, rememberRecent, teamHint, teamSections, type TeamPick } from "@/domain/team-picker";
import { setTeamAction } from "@/app/actions/team";
import { cn } from "@/lib/cn";

/** Пункт окна: команда или «Все мои команды». key уникален в окне: одна команда бывает и в «Ваших», и в «Недавних» */
type Row = { key: string; id: string; name: string; hint: string; depth: number; note: string | null; index: number };

const ALL_ROW_HINT = "Задачи и weekly всех команд из списка вместе";

export function TeamSwitcher({ compact = false }: { compact?: boolean }) {
  const { team, notify, me, viewing } = usePrototype();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Команды с руководителем и командой выше из снимка справочников: одноимённые различаются второй строкой
  const picks = useMemo<TeamPick[]>(
    () =>
      team.options.map((o) => {
        const entry = teamOf(o.id);
        return {
          ...o,
          leader: entry?.leader ? personOf(entry.leader).fullName : null,
          parent: entry?.parent ? (teamOf(entry.parent)?.name ?? null) : null,
        };
      }),
    [team.options],
  );

  const sections = useMemo(() => {
    const rowOf = (section: string, t: TeamPick, indent: boolean): Row => ({
      key: `${section}:${t.id}`,
      id: t.id,
      name: t.name,
      hint: teamHint(t.leader, t.parent),
      depth: indent ? Math.min(t.depth, 4) : 0,
      note: t.relation === "leader" ? "вы руководитель" : t.relation === "member" ? "вы участник" : null,
      index: 0,
    });
    const allRow: Row = { key: "all:*", id: ALL_TEAMS, name: "Все мои команды", hint: ALL_ROW_HINT, depth: 0, note: null, index: 0 };
    const list = teamSections(picks, recent, query).map((s) => ({ key: s.key, title: s.title, rows: s.items.map((t) => rowOf(s.key, t, s.key === "all")) }));
    // «Все мои команды» первым пунктом раздела всех команд, а в поиске, если запрос подходит к названию
    const all = list.find((s) => s.key === "all");
    if (all) all.rows.unshift(allRow);
    const found = list.find((s) => s.key === "found");
    if (found && matchTeam({ name: allRow.name, leader: null }, query)) found.rows.push(allRow);
    // Сквозной номер пункта: по нему ходят стрелки
    let n = 0;
    for (const sec of list) sec.rows = sec.rows.map((r) => ({ ...r, index: n++ }));
    return list;
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
  const name = team.id === ALL_TEAMS ? "Все мои команды" : (current?.name ?? team.name);
  const lead = current?.relation === "leader";
  const listId = `${id}-list`;
  const activeRow = rows[cursor];

  const onOpenChange = (next: boolean) => {
    if (next) {
      // «Недавние» читаются при каждом открытии: команду могли сменить в другой вкладке
      setRecent(readRecent(me.slug));
      setQuery("");
      setCursor(0);
    }
    setOpen(next);
  };

  const choose = (row: Row) => {
    setOpen(false);
    if (row.id === team.id) return;
    // Свои команды всегда сверху, в «Недавних» они не нужны. В просмотре «Смотреть как» устройство владельца не трогаем
    const own = team.options.some((o) => o.id === row.id && (o.relation === "leader" || o.relation === "member"));
    if (row.id !== ALL_TEAMS && !own && !viewing) setRecent(rememberRecent(me.slug, row.id));
    start(async () => {
      const r = await setTeamAction(row.id);
      if (!r.ok) notify(r.error, "error");
      router.refresh();
    });
  };

  const move = (to: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, to));
    setCursor(next);
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
            // Фокус сразу в строке поиска, а не на кнопке «Закрыть»: можно печатать без щелчка
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
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={activeRow ? `${id}-opt-${activeRow.key}` : undefined}
                aria-autocomplete="list"
                aria-label="Поиск команды"
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
}
