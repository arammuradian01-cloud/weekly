"use client";

// Состояние экранов. Задачи с этапа 3 живут в базе: экран получает их с сервера и правит через server actions.
// Weekly пока прототип в памяти браузера (этап 4): правки видны сразу, после обновления страницы всё возвращается.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildPrototypeData, type PrototypeData } from "./data";
import { personOf } from "./people";
import type { Person, PersonSlug, PersonWeekly, Task, WeeklyEntry } from "./types";
import { addCommentAction, createTaskAction, undoAction, type TaskActionResult } from "@/app/(app)/tasks/actions";
import type { NewTaskInput } from "@/lib/tasks/service";

type Toast = { id: number; text: string; undo?: Omit<PrototypeData, "tasks">; undoToken?: string; tone?: "error" };

type Store = {
  data: PrototypeData;
  me: Person;
  /** Включён режим управления владельца или администратора */
  manage: boolean;
  manageRole: "OWNER" | "ADMIN" | null;
  /** Наблюдатель только читает */
  observer: boolean;
  /** Ответ сервера по задаче: обновить её на экране, показать тост с отменой или ошибку. true, если сохранилось */
  applyTaskResult: (result: TaskActionResult, toastText: string) => boolean;
  /** Выполнить действие с задачей на сервере и применить ответ */
  runTask: (action: () => Promise<TaskActionResult>, toastText: string) => Promise<boolean>;
  addComment: (number: number, text: string) => Promise<boolean>;
  /** Номер новой задачи или текст ошибки */
  createTask: (input: NewTaskInput) => Promise<{ number: number } | { error: string }>;
  saveEntry: (entry: WeeklyEntry) => void;
  /** Общая запись без автора получает автора: только владелец и администратор */
  assignAuthor: (id: string, author: PersonSlug) => void;
  removeEntry: (id: string) => void;
  saveWeekly: (weekly: PersonWeekly, toast?: string) => void;
  toggleCeo: (id: string) => void;
  toast: Toast | null;
  notify: (text: string) => void;
  dismissToast: () => void;
  undo: () => void;
};

const StoreContext = createContext<Store | null>(null);

export function PrototypeProvider({
  today,
  reportingWeek,
  me,
  manageRole,
  observer = false,
  initialTasks,
  children,
}: {
  today: string;
  reportingWeek: number;
  me: PersonSlug;
  manageRole: "OWNER" | "ADMIN" | null;
  observer?: boolean;
  /** Задачи из базы на момент отрисовки страницы */
  initialTasks: Task[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [proto, setProto] = useState<Omit<PrototypeData, "tasks">>(() => buildPrototypeData(today, reportingWeek));
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  // Сервер прислал свежие задачи (после router.refresh или перехода): берём их
  useEffect(() => setTasks(initialTasks), [initialTasks]);

  // Чужие правки подтягиваются, когда вкладка снова на виду, и раз в минуту, пока открыта
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", refresh);
    const id = setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(id);
    };
  }, [router]);

  const showToast = useCallback((text: string, extra?: Partial<Omit<Toast, "id" | "text">>) => {
    seq.current += 1;
    setToast({ id: seq.current, text, ...extra });
    if (timer.current) clearTimeout(timer.current);
    // Отменить последнее действие можно 5 секунд (раздел 7 ТЗ), ошибка висит дольше
    timer.current = setTimeout(() => setToast(null), extra?.tone === "error" ? 8000 : 5000);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const mutate = useCallback(
    (fn: (d: Omit<PrototypeData, "tasks">) => Omit<PrototypeData, "tasks">, toastText = "Сохранено") => {
      setProto((prev) => {
        const next = fn(prev);
        // Тост показываем вне setState, иначе React ругается на обновление во время рендера
        queueMicrotask(() => showToast(toastText, { undo: prev }));
        return next;
      });
    },
    [showToast],
  );

  const applyTaskResult = useCallback(
    (result: TaskActionResult, toastText: string): boolean => {
      if (!result.ok) {
        showToast(result.error, { tone: "error" });
        return false;
      }
      setTasks((prev) => {
        if (result.task === null) return prev.filter((t) => t.number !== result.number);
        const exists = prev.some((t) => t.number === result.number);
        return exists ? prev.map((t) => (t.number === result.number ? result.task! : t)) : [...prev, result.task];
      });
      showToast(toastText, { undoToken: result.undo });
      // Остальные экраны (сводки, «Моя неделя») пересчитаются с сервера
      router.refresh();
      return true;
    },
    [router, showToast],
  );

  const data = useMemo<PrototypeData>(() => ({ ...proto, tasks }), [proto, tasks]);

  const store = useMemo<Store>(() => {
    return {
      data,
      me: personOf(me),
      manage: manageRole !== null,
      manageRole,
      observer,
      applyTaskResult,
      runTask: async (action, toastText) => {
        try {
          return applyTaskResult(await action(), toastText);
        } catch {
          showToast("Нет связи с сервером: правка не сохранилась", { tone: "error" });
          return false;
        }
      },
      addComment: async (number, text) => {
        try {
          return applyTaskResult(await addCommentAction(number, text), "Комментарий добавлен");
        } catch {
          showToast("Нет связи с сервером: комментарий не сохранился", { tone: "error" });
          return false;
        }
      },
      createTask: async (input) => {
        try {
          const result = await createTaskAction(input);
          if (!result.ok) return { error: result.error };
          applyTaskResult(result, result.task?.status === "proposed" ? `Задача ${result.number} предложена` : `Задача ${result.number} создана`);
          return { number: result.number };
        } catch {
          return { error: "Нет связи с сервером: задача не сохранилась" };
        }
      },
      saveEntry: (entry) =>
        mutate((d) => {
          const exists = d.entries.some((e) => e.id === entry.id);
          return { ...d, entries: exists ? d.entries.map((e) => (e.id === entry.id ? entry : e)) : [...d.entries, entry] };
        }),
      assignAuthor: (id, author) =>
        mutate(
          (d) => ({ ...d, entries: d.entries.map((e) => (e.id === id ? { ...e, author } : e)) }),
          `Запись передана: ${personOf(author).fullName}`,
        ),
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
        if (toast?.undoToken) {
          const token = toast.undoToken;
          setToast(null);
          undoAction(token)
            .then((result) => applyTaskResult(result, "Отменено"))
            .catch(() => showToast("Нет связи с сервером: отменить не получилось", { tone: "error" }));
          return;
        }
        if (toast?.undo) {
          setProto(toast.undo);
          setToast(null);
        }
      },
    };
  }, [data, me, manageRole, observer, mutate, toast, showToast, applyTaskResult]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function usePrototype(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("usePrototype вне PrototypeProvider");
  return ctx;
}
