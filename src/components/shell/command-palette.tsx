"use client";

// Командная строка по Cmd+K (этап 25, модуль М10): найти и сразу сделать. Сверху действия и переходы, ниже результаты
// общего поиска по задачам, записям weekly, решениям, комментариям и людям. Стрелки ходят по списку, Enter открывает.
// На телефоне открывается кнопкой поиска в шапке и занимает весь экран

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, Plus, CornerDownLeft, FileText, ListChecks, Newspaper, Gavel, Users, Inbox, CalendarCheck2, Target, LayoutDashboard, MessageSquareText, UserRound, type LucideIcon } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { compactName } from "@/domain/people";
import { formatShort } from "@/domain/dates";
import { statusOf, type StatusCode } from "@/domain/dictionaries";
import { cn } from "@/lib/cn";
import { MARK_END, MARK_START, SEARCH_MIN, hitHref, hitId, type SearchHit } from "@/lib/search/common";
import { searchAction } from "@/app/(app)/search/actions";
import { openNewTask } from "@/components/prototype/new-task";

const OPEN_EVENT = "weekly:command-palette";

export function openCommandPalette(initial = "") {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: initial }));
}

type Command = { id: string; label: string; hint?: string; icon: LucideIcon; run: () => void; keywords?: string };

type Item = { id: string; kind: "command" | "hit"; command?: Command; hit?: SearchHit; href?: string };

/** Текст с маркерами найденных слов в подсвеченный фрагмент */
export function Highlight({ text, className }: { text: string; className?: string }) {
  const parts = text.split(MARK_START);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        if (i === 0) return <span key={i}>{p}</span>;
        const [hit, rest] = p.split(MARK_END);
        return (
          <span key={i}>
            <mark className="rounded-sm bg-warning-soft px-0.5 text-ink">{hit}</mark>
            {rest}
          </span>
        );
      })}
    </span>
  );
}

const DEBOUNCE_MS = 180;

export function CommandPalette({ management }: { management: "OWNER" | "ADMIN" | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const { observer } = usePrototype();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const seq = useRef(0);

  // Открытие: Cmd+K или Ctrl+K с любого места, событие от кнопки в шапке
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = (e: Event) => {
      setQ(String((e as CustomEvent).detail ?? ""));
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setHits([]);
      setError(null);
      setCursor(0);
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Поиск с задержкой на ввод: ответ на устаревший запрос отбрасывается
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length < SEARCH_MIN) {
      setHits([]);
      setBusy(false);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      searchAction(query)
        .then((r) => {
          if (mine !== seq.current) return;
          if (r.ok) {
            setHits(r.value.hits);
            setError(null);
          } else setError(r.error);
        })
        .catch(() => mine === seq.current && setError("Нет связи с сервером"))
        .finally(() => mine === seq.current && setBusy(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    if (!observer) list.push({ id: "new-task", label: "Новая задача", hint: "N", icon: Plus, keywords: "создать поставить задачу", run: () => { setOpen(false); openNewTask(); } });
    if (!observer) list.push({ id: "submit", label: "Сдать weekly", icon: Newspaper, keywords: "weekly сдача отчёт неделя", run: () => go("/weekly/submit") });
    const sections: [string, string, LucideIcon, string][] = [
      ["/", "Моя неделя", CalendarCheck2, "главная домой"],
      ["/me", "Мне", Inbox, "входящие события уведомления"],
      ["/weekly", "Weekly", Newspaper, "лента записи"],
      ["/weekly/meeting", "Встреча", Users, "повестка встреча вторник"],
      ["/tasks", "Задачи", ListChecks, "список задач"],
      ["/tasks/mine", "Мои задачи", ListChecks, "мои"],
      ["/goals", "Цели", Target, "цели квартала"],
      ["/decisions", "Решения", Gavel, "журнал решений"],
      ["/my-teams", "Мои команды", LayoutDashboard, "панель руководителя"],
      ["/team", "Команда", Users, "люди состав"],
    ];
    for (const [href, label, icon, keywords] of sections) list.push({ id: `go:${href}`, label: `Открыть: ${label}`, icon, keywords, run: () => go(href) });
    if (management) {
      list.push({ id: "go:/ceo-report", label: "Открыть: Отчёт CEO", icon: FileText, keywords: "отчёт ceo", run: () => go("/ceo-report") });
      list.push({ id: "go:/journal", label: "Открыть: Журнал", icon: FileText, keywords: "журнал аудит история", run: () => go("/journal") });
    }
    return list;
  }, [observer, management, go]);

  const query = q.trim().toLowerCase();
  const shownCommands = useMemo(() => {
    if (!query) return commands.slice(0, 6);
    return commands.filter((c) => `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(query)).slice(0, 4);
  }, [commands, query]);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = shownCommands.map((c) => ({ id: c.id, kind: "command", command: c }));
    for (const h of hits) list.push({ id: hitId(h), kind: "hit", hit: h, href: hitHref(h) });
    if (query.length >= SEARCH_MIN) list.push({ id: "all", kind: "command", command: { id: "all", label: `Все результаты: «${q.trim()}»`, icon: Search, run: () => go(`/search?q=${encodeURIComponent(q.trim())}`) } });
    return list;
  }, [shownCommands, hits, query, q, go]);

  useEffect(() => setCursor(0), [items.length, q]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const activate = (item: Item) => {
    if (item.kind === "command") item.command!.run();
    else if (item.href) go(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(items.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[cursor];
      if (item) activate(item);
    }
  };

  // Сгруппировать результаты по виду для заголовков
  const groups = useMemo(() => {
    const out: { title: string; items: { item: Item; index: number }[] }[] = [];
    const push = (title: string, item: Item, index: number) => {
      const g = out.find((x) => x.title === title) ?? (out.push({ title, items: [] }), out[out.length - 1]!);
      g.items.push({ item, index });
    };
    items.forEach((item, index) => {
      if (item.kind === "command") push(item.id === "all" ? "" : "Действия", item, index);
      else push(KIND_TITLES[item.hit!.kind], item, index);
    });
    return out;
  }, [items]);

  const activeId = items[cursor] ? `cmd-${items[cursor]!.id}` : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-navy/30" />
        <Dialog.Content
          aria-label="Командная строка"
          className="fixed inset-0 z-50 flex flex-col bg-white outline-none sm:inset-auto sm:left-1/2 sm:top-[12vh] sm:max-h-[72vh] sm:w-[calc(100%-32px)] sm:max-w-[640px] sm:-translate-x-1/2 sm:rounded-xl sm:shadow-modal"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="sr-only">Командная строка: поиск и действия</Dialog.Title>
          <Dialog.Description className="sr-only">Введите слова для поиска или название действия. Стрелки ходят по списку, Enter открывает, Esc закрывает</Dialog.Description>
          <div className="relative border-b border-line">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded="true"
              aria-controls="command-list"
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-label="Поиск и действия"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Задачи, записи, решения, люди или действие"
              className="h-14 w-full bg-transparent pl-12 pr-24 text-body text-ink placeholder:text-muted outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-tiny text-muted">
              {busy ? <span aria-live="polite">Ищу…</span> : null}
              <kbd className="hidden rounded border border-line bg-surface px-1.5 leading-5 sm:inline" aria-hidden="true">Esc</kbd>
            </div>
          </div>
          <ul ref={listRef} id="command-list" role="listbox" aria-label="Результаты" className="flex-1 overflow-y-auto overscroll-contain p-2 pb-[max(8px,env(safe-area-inset-bottom))]">
            {groups.map((g) => (
              <li key={g.title || "all"} role="presentation">
                {g.title ? <p className="px-3 pb-1 pt-3 text-caption text-muted">{g.title}</p> : null}
                <ul role="group" aria-label={g.title || "Ещё"}>
                  {g.items.map(({ item, index }) => (
                    <li
                      key={item.id}
                      id={`cmd-${item.id}`}
                      role="option"
                      aria-selected={index === cursor}
                      data-index={index}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => activate(item)}
                      className={cn("flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5", index === cursor ? "bg-blue-soft" : "hover:bg-surface")}
                    >
                      <ItemRow item={item} />
                      {index === cursor ? <CornerDownLeft className="mt-1 h-4 w-4 shrink-0 text-muted" aria-hidden="true" /> : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {query.length >= SEARCH_MIN && !busy && !hits.length && !error ? <li className="px-3 py-4 text-small text-muted">По запросу «{q.trim()}» ничего не нашлось. Попробуйте другое слово или номер задачи.</li> : null}
            {error ? <li className="px-3 py-4 text-small text-danger-ink">{error}</li> : null}
            {!query ? <li className="px-3 py-3 text-caption text-muted">Поиск идёт по словоформам: «доступ» найдёт и «доступа». Номер задачи открывает её сразу.</li> : null}
          </ul>
          <p className="hidden items-center gap-3 border-t border-line px-4 py-2 text-tiny text-muted sm:flex">
            <span><kbd className="rounded border border-line bg-surface px-1">↑↓</kbd> выбрать</span>
            <span><kbd className="rounded border border-line bg-surface px-1">Enter</kbd> открыть</span>
            <span className="ml-auto">{pathname === "/search" ? "" : "⌘K или Ctrl+K"}</span>
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const KIND_TITLES: Record<SearchHit["kind"], string> = { task: "Задачи", entry: "Записи weekly", decision: "Решения", comment: "Комментарии", person: "Люди" };

function ItemRow({ item }: { item: Item }) {
  if (item.kind === "command") {
    const c = item.command!;
    const Icon = c.icon;
    return (
      <>
        <Icon className="mt-0.5 h-4.5 w-4.5 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-body text-ink">{c.label}</span>
        {c.hint ? <kbd className="rounded border border-line bg-surface px-1.5 text-tiny text-muted" aria-hidden="true">{c.hint}</kbd> : null}
      </>
    );
  }
  const h = item.hit!;
  const Icon: LucideIcon = h.kind === "task" ? ListChecks : h.kind === "entry" ? Newspaper : h.kind === "decision" ? Gavel : h.kind === "comment" ? MessageSquareText : UserRound;
  return (
    <>
      <Icon className="mt-0.5 h-4.5 w-4.5 shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <HitTitle hit={h} />
        <Highlight text={h.snippet} className="mt-0.5 line-clamp-2 block text-small text-muted" />
      </span>
    </>
  );
}

/** Заголовок результата: что это и откуда */
export function HitTitle({ hit: h }: { hit: SearchHit }) {
  if (h.kind === "task") {
    return (
      <span className={cn("block text-body font-medium", h.closed ? "text-muted" : "text-ink")}>
        <span className="tabular-nums text-muted">{h.number}</span> {h.title}
        <span className="ml-2 text-caption font-normal text-muted">
          {statusOf(h.status as StatusCode).label}, {h.owner === "all" ? "все лидеры" : h.owner ? compactName(h.owner) : "без ответственного"}, срок {formatShort(h.due)}
        </span>
      </span>
    );
  }
  if (h.kind === "entry") return <span className="block text-body font-medium text-ink">Запись weekly, неделя {h.weekNumber}{h.author ? `, ${compactName(h.author)}` : ""}</span>;
  if (h.kind === "decision") return <span className="block text-body font-medium text-ink">Решение от {formatShort(h.date)}{h.status === "cancelled" ? ", отменено" : ""}{h.owner ? `, ${compactName(h.owner)}` : ""}</span>;
  if (h.kind === "comment") return <span className="block text-body font-medium text-ink">{h.author ? compactName(h.author) : "Комментарий"} в {h.task ? `задаче ${h.task.number}` : "записи weekly"}</span>;
  return (
    <span className="block text-body font-medium text-ink">
      <Highlight text={h.snippet} />
      {h.position ? <span className="ml-2 text-caption font-normal text-muted">{h.position}</span> : null}
    </span>
  );
}
