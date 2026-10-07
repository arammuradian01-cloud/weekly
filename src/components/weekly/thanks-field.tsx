"use client";

// «Спасибо @коллега за…» в weekly (этап 22, модуль М6): необязательная строка. Сохраняется сама через пару секунд,
// упомянутый коллега получает событие в «Мне». Строки собираются в блок «Благодарности» отчёта CEO.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrototype } from "@/domain/store";
import type { WeekKey } from "@/domain/types";
import { saveThanksAction } from "@/app/(app)/weekly/actions";
import { MentionArea } from "@/components/discuss/mention-area";

const THANKS_MAX = 300;

export function ThanksField({ week, initial, canEdit }: { week: WeekKey; initial: string; canEdit: boolean }) {
  const { notify } = usePrototype();
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const saved = useRef(initial);
  const pending = useRef(initial);
  pending.current = value;

  const save = useCallback(async () => {
    const text = pending.current;
    if (text === saved.current || text.length > THANKS_MAX) return;
    setState("saving");
    try {
      const r = await saveThanksAction(week, text);
      if (!r.ok) {
        setState("idle");
        return notify(r.error, "error");
      }
      saved.current = text;
      setState("saved");
      if (r.value.warning) notify(r.value.warning, "error");
    } catch {
      setState("idle");
      notify("Нет связи с сервером: благодарность не сохранилась", "error");
    }
  }, [week, notify]);

  useEffect(() => {
    if (!canEdit || value === saved.current) return;
    // Новый текст ещё не сохранён: прежнее «сохранена» убираем
    setState("idle");
    const t = setTimeout(() => void save(), 2000);
    return () => clearTimeout(t);
  }, [value, canEdit, save]);

  // Ушли со страницы, не дождавшись автосохранения: сохраняем сразу
  useEffect(() => () => void save(), [save]);

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void save();
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [save]);

  if (!canEdit && !initial) return null;
  return (
    <div className="flex flex-col gap-1" onBlur={() => void save()}>
      <MentionArea
        id="thanks"
        label="Спасибо коллеге, если есть за что"
        value={value}
        onChange={setValue}
        rows={1}
        disabled={!canEdit}
        counter={{ value: value.length, max: THANKS_MAX }}
        hint="Например: «Спасибо @Логинова Светлана за выгрузку по убыткам». Коллега увидит это в «Мне», строка попадёт в отчёт CEO"
      />
      <span className="text-caption text-muted" aria-live="polite">
        {state === "saving" ? "Сохраняю" : state === "saved" ? "Благодарность сохранена" : ""}
      </span>
    </div>
  );
}
