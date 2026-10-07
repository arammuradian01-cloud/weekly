"use client";

// Повестки ещё нет (этап 23): плашка над встречей по ленте. Руководитель собирает повестку одной кнопкой, после
// этого встреча идёт по пунктам с живым режимом и решениями.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListPlus } from "lucide-react";
import { usePrototype } from "@/domain/store";
import type { WeekKey } from "@/domain/types";
import { buildAgendaAction } from "@/app/(app)/meeting/actions";
import { Button } from "@/components/ui/button";

export function BuildAgendaBanner({ team, week, canLead }: { team: { id: string; name: string }; week: WeekKey; canLead: boolean }) {
  const router = useRouter();
  const { notify } = usePrototype();
  const [busy, setBusy] = useState(false);
  const build = async () => {
    setBusy(true);
    try {
      const r = await buildAgendaAction(team.id, week);
      if (!r.ok) return notify(r.error, "error");
      notify("Повестка собрана");
      router.refresh();
    } catch {
      notify("Нет связи с сервером", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl bg-field px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-body text-ink">
        Повестка встречи {team.name} ещё не собрана. Она соберётся сама к сроку сдачи weekly: поручения прошлой встречи, зависшие просьбы, риски, вопросы, лидеры по очереди.
        {canLead ? "" : " Собрать раньше может руководитель команды."}
      </p>
      {canLead ? (
        <Button size="sm" onClick={() => void build()} disabled={busy} className="shrink-0">
          <ListPlus className="h-4 w-4" aria-hidden="true" />
          {busy ? "Собираю…" : "Собрать повестку"}
        </Button>
      ) : null}
    </div>
  );
}
