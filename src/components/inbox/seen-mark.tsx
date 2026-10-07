"use client";

import { useEffect } from "react";
import { markSeenAction } from "@/app/(app)/me/actions";

/** Предмет открыт: события «Мне» по нему просмотрены, письмо о них не уйдёт (этап 20) */
export function SeenMark({ subject }: { subject: string }) {
  useEffect(() => {
    markSeenAction([subject]).catch(() => undefined);
  }, [subject]);
  return null;
}
