"use client";

// Ключевые цифры «Мне» (этап 36, строкой с этапа 44): «13 просрочено, 1 просьба ждёт ответа, 2 события». Каждая часть
// ведёт к своей группе очереди. Нули не показываются, при пустой очереди строки нет

import type { RequestView } from "@/domain/requests";
import { usePrototype } from "@/domain/store";
import { Figures } from "@/components/ui/data";
import { hotTasks, meFigureLabels, splitRequests } from "./me-tasks";

export function MeFigures({ incoming, events }: { incoming: RequestView[]; events: number }) {
  const { data, me } = usePrototype();
  const tasks = hotTasks(data, me);
  const req = splitRequests(incoming, data.today);
  const n = { late: tasks.late.length + req.late.length, soon: tasks.soon.length + req.soon.length, answer: req.answer.length, events };
  const labels = meFigureLabels(n);
  return (
    <Figures
      label="Мне в цифрах"
      inline
      items={[
        { label: labels.late, value: n.late, href: "#me-late", tone: "danger", testId: "me-fig-late" },
        { label: labels.soon, value: n.soon, href: "#me-soon", tone: "warning", testId: "me-fig-soon" },
        { label: labels.answer, value: n.answer, href: "#me-answer", testId: "me-fig-requests" },
        { label: labels.events, value: n.events, href: "#me-read", testId: "me-fig-events" },
      ]}
    />
  );
}
