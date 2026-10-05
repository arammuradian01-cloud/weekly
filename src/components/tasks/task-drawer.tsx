"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { usePrototype } from "@/prototype/store";
import { Drawer } from "@/components/ui/overlays";
import { TaskCard } from "./task-card";

/** Номер открытой задачи живёт в адресе (?task=12): карточку можно открыть ссылкой и закрыть кнопкой «назад» */
export function useOpenTask() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = useCallback(
    (number: number | null) => {
      const next = new URLSearchParams(params.toString());
      if (number === null) next.delete("task");
      else next.set("task", String(number));
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, params],
  );
  const current = Number(params.get("task")) || null;
  return { current, open };
}

export function TaskDrawer() {
  const { data } = usePrototype();
  const { current, open } = useOpenTask();
  const task = current ? data.tasks.find((t) => t.number === current) : undefined;
  return (
    <Drawer
      open={!!task}
      onOpenChange={(o) => !o && open(null)}
      wide
      title={
        task ? (
          <>
            <span className="mr-2 font-normal tabular-nums text-muted">{task.number}</span>
            {task.title}
          </>
        ) : (
          ""
        )
      }
    >
      {task ? <TaskCard key={`${task.number}-${task.where}`} task={task} /> : null}
    </Drawer>
  );
}
