"use client";

// Общее состояние экранов: кто я, режим управления, задачи и тост «Сохранено» с отменой.
// Задачи живут в базе (этап 3): экран получает их с сервера и правит через server actions.
// Weekly с этапа 4 тоже в базе, но каждая страница берёт свою неделю с сервера сама.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { peopleOf, personOf } from "./people";
import type { Person, PersonSlug, Task } from "./types";
import type { IsoDate } from "./dates";
import { addCommentAction, createTaskAction, undoAction, type TaskActionResult } from "@/app/(app)/tasks/actions";
import type { NewTaskInput } from "@/lib/tasks/service";
import { applyRegistry, type RegistrySnapshot } from "./registry";
import { ALL_TEAMS, TOP_TEAM } from "./teams";

type Toast = { id: number; text: string; undoToken?: string; onUndo?: () => void; tone?: "error" };

/**
 * tasks: задачи выбранной команды и свои задачи в любой команде (этап 14). teamTasks: только задачи выбранной команды,
 * по ним строятся список, доска, сводка команды и разбор на встрече
 */
export type AppData = { today: IsoDate; tasks: Task[]; team: string | null; teamTasks: Task[] };

/** Выбранная команда для переключателя в шапке */
export type CurrentTeamView = {
  id: string | null;
  name: string;
  people: PersonSlug[];
  options: { id: string; name: string; depth: number; relation: "member" | "leader" | "below" | "all" }[];
};

type Store = {
  data: AppData;
  me: Person;
  /** Включён режим управления владельца или администратора */
  manage: boolean;
  manageRole: "OWNER" | "ADMIN" | null;
  /** Наблюдатель только читает */
  observer: boolean;
  /** Команды, которыми человек руководит, с командами ниже (этап 14) */
  leads: string[];
  team: CurrentTeamView;
  /** Люди выбранной команды (руководитель и участники, включённые, без наблюдателей): ответственные, сводки, разбор */
  teamPeople: Person[];
  /** Ответ сервера по задаче: обновить её на экране, показать тост с отменой или ошибку. true, если сохранилось */
  applyTaskResult: (result: TaskActionResult, toastText: string) => boolean;
  /** Выполнить действие с задачей на сервере и применить ответ */
  runTask: (action: () => Promise<TaskActionResult>, toastText: string) => Promise<boolean>;
  addComment: (number: number, text: string) => Promise<boolean>;
  /** Номер новой задачи или текст ошибки */
  createTask: (input: NewTaskInput) => Promise<{ number: number } | { error: string }>;
  toast: Toast | null;
  notify: (text: string, tone?: "error") => void;
  /** Тост с кнопкой «Отменить» для правок не по задачам, например удаления записи weekly */
  notifyUndo: (text: string, onUndo: () => void) => void;
  dismissToast: () => void;
  undo: () => void;
};

const StoreContext = createContext<Store | null>(null);

export function PrototypeProvider({
  today,
  me,
  manageRole,
  observer = false,
  initialTasks,
  registry,
  team,
  leads = [],
  children,
}: {
  today: string;
  me: PersonSlug;
  /** Люди и справочники из базы: подменяют стартовые значения до отрисовки страниц */
  registry: RegistrySnapshot;
  manageRole: "OWNER" | "ADMIN" | null;
  observer?: boolean;
  /** Задачи из базы на момент отрисовки страницы */
  initialTasks: Task[];
  team: CurrentTeamView;
  leads?: string[];
  children: React.ReactNode;
}) {
  applyRegistry(registry);
  const router = useRouter();
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

  const teamPeople = useMemo(() => peopleOf(team.people), [team.people, registry.version]);
  const data = useMemo<AppData>(
    () => ({
      today,
      tasks,
      team: team.id,
      // «Все мои команды»: все задачи, что пришли; без команды: только свои
      // И предложенные людям команды задачи из других команд: просьбы к ним (этап 16)
      teamTasks:
        team.id === ALL_TEAMS || team.id === null
          ? tasks
          : tasks.filter((t) => t.team === team.id || (team.id !== TOP_TEAM && t.status === "proposed" && t.owner !== "all" && team.people.includes(t.owner))),
    }),
    [today, tasks, team.id],
  );

  const store = useMemo<Store>(() => {
    return {
      data,
      me: personOf(me),
      manage: manageRole !== null,
      manageRole,
      observer,
      leads,
      team,
      teamPeople,
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
      toast,
      notify: (text, tone) => showToast(text, tone ? { tone } : undefined),
      notifyUndo: (text, onUndo) => showToast(text, { onUndo }),
      dismissToast: () => setToast(null),
      undo: () => {
        if (toast?.onUndo) {
          const run = toast.onUndo;
          setToast(null);
          run();
          return;
        }
        if (toast?.undoToken) {
          const token = toast.undoToken;
          setToast(null);
          undoAction(token)
            .then((result) => applyTaskResult(result, "Отменено"))
            .catch(() => showToast("Нет связи с сервером: отменить не получилось", { tone: "error" }));
          return;
        }
      },
    };
  }, [data, me, manageRole, observer, leads, team, teamPeople, toast, showToast, applyTaskResult]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function usePrototype(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("usePrototype вне PrototypeProvider");
  return ctx;
}
