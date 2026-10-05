"use client";

// Состояние прототипа живёт в памяти браузера: правки видны сразу, после обновления страницы всё возвращается.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { buildPrototypeData, type PrototypeData } from "./data";
import { personOf } from "./people";
import type { HistoryItem, Person, PersonSlug, PersonWeekly, Task, WeeklyEntry } from "./types";

type Toast = { id: number; text: string; undo?: PrototypeData };

type Store = {
  data: PrototypeData;
  me: Person;
  /** Включён режим управления владельца или администратора */
  manage: boolean;
  manageRole: "OWNER" | "ADMIN" | null;
  updateTask: (number: number, patch: Partial<Task>, change: { field: string; before?: string; after?: string }, toast?: string) => void;
  addComment: (number: number, text: string) => void;
  createTask: (task: Omit<Task, "number" | "history" | "comments" | "createdAt" | "updatedAt" | "createdBy">) => number;
  saveEntry: (entry: WeeklyEntry) => void;
  removeEntry: (id: string) => void;
  saveWeekly: (weekly: PersonWeekly, toast?: string) => void;
  toggleCeo: (id: string) => void;
  toast: Toast | null;
  notify: (text: string) => void;
  dismissToast: () => void;
  undo: () => void;
};

const StoreContext = createContext<Store | null>(null);

function nowTime(): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date());
}

export function PrototypeProvider({
  today,
  reportingWeek,
  me,
  manageRole,
  children,
}: {
  today: string;
  reportingWeek: number;
  me: PersonSlug;
  manageRole: "OWNER" | "ADMIN" | null;
  children: React.ReactNode;
}) {
  const [data, setData] = useState<PrototypeData>(() => buildPrototypeData(today, reportingWeek));
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const showToast = useCallback((text: string, undo?: PrototypeData) => {
    seq.current += 1;
    setToast({ id: seq.current, text, undo });
    if (timer.current) clearTimeout(timer.current);
    // Отменить последнее действие можно 5 секунд (раздел 7 ТЗ)
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const mutate = useCallback(
    (fn: (d: PrototypeData) => PrototypeData, toastText = "Сохранено") => {
      setData((prev) => {
        const next = fn(prev);
        // Тост показываем вне setState, иначе React ругается на обновление во время рендера
        queueMicrotask(() => showToast(toastText, prev));
        return next;
      });
    },
    [showToast],
  );

  const store = useMemo<Store>(() => {
    const historyItem = (change: { field: string; before?: string; after?: string }): HistoryItem => ({
      id: `h${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      at: data.today,
      time: nowTime(),
      by: me,
      ...change,
    });

    return {
      data,
      me: personOf(me),
      manage: manageRole !== null,
      manageRole,
      updateTask: (number, patch, change, toastText) =>
        mutate(
          (d) => ({
            ...d,
            tasks: d.tasks.map((t) =>
              t.number === number ? { ...t, ...patch, updatedAt: d.today, history: [historyItem(change), ...t.history] } : t,
            ),
          }),
          toastText,
        ),
      addComment: (number, text) =>
        mutate(
          (d) => ({
            ...d,
            tasks: d.tasks.map((t) =>
              t.number === number
                ? { ...t, comments: [...t.comments, { id: `k${Date.now()}`, author: me, text, at: d.today, time: nowTime() }] }
                : t,
            ),
          }),
          "Комментарий добавлен",
        ),
      createTask: (task) => {
        const number = Math.max(...data.tasks.map((t) => t.number)) + 1;
        mutate(
          (d) => ({
            ...d,
            tasks: [
              ...d.tasks,
              {
                ...task,
                number,
                comments: [],
                createdAt: d.today,
                updatedAt: d.today,
                createdBy: me,
                history: [historyItem({ field: "Задача создана", after: task.title })],
              },
            ],
          }),
          `Задача ${number} создана`,
        );
        return number;
      },
      saveEntry: (entry) =>
        mutate((d) => {
          const exists = d.entries.some((e) => e.id === entry.id);
          return { ...d, entries: exists ? d.entries.map((e) => (e.id === entry.id ? entry : e)) : [...d.entries, entry] };
        }),
      removeEntry: (id) => mutate((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== id) }), "Запись удалена"),
      saveWeekly: (weekly, toastText) =>
        mutate((d) => {
          const exists = d.weeklies.some((w) => w.week === weekly.week && w.author === weekly.author);
          return {
            ...d,
            weeklies: exists
              ? d.weeklies.map((w) => (w.week === weekly.week && w.author === weekly.author ? weekly : w))
              : [...d.weeklies, weekly],
          };
        }, toastText),
      toggleCeo: (id) =>
        mutate((d) => ({ ...d, entries: d.entries.map((e) => (e.id === id ? { ...e, ceo: !e.ceo } : e)) })),
      toast,
      notify: (text) => showToast(text),
      dismissToast: () => setToast(null),
      undo: () => {
        if (toast?.undo) {
          setData(toast.undo);
          setToast(null);
        }
      },
    };
  }, [data, me, manageRole, mutate, toast, showToast]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function usePrototype(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("usePrototype вне PrototypeProvider");
  return ctx;
}
