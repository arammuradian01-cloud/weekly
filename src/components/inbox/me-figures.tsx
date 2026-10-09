"use client";

// Ключевые цифры «Мне» (этап 36): просьбы ко мне, их просрочка, события и мои сроки. Цифры ведут к своему разделу
// страницы. Сроки считаются здесь же из задач, как блок «Сроки» ниже

import { usePrototype } from "@/domain/store";
import { addDays } from "@/domain/dates";
import { isMine, isOverdue } from "@/domain/rules";
import { Figures } from "@/components/ui/data";

export function MeFigures({ requests, overdueRequests, events }: { requests: number; overdueRequests: number; events: number }) {
  const { data, me } = usePrototype();
  const tomorrow = addDays(data.today, 1);
  const open = data.tasks.filter((t) => !t.archived && isMine(t, me.slug, me.role) && ["in-progress", "clarify", "proposed"].includes(t.status));
  const late = open.filter((t) => isOverdue(t, data.today)).length;
  const soon = open.filter((t) => !isOverdue(t, data.today) && t.due <= tomorrow).length;
  // Всё разобрано: пять нулей ничего не добавляют к пустому списку ниже
  if (!requests && !events && !late && !soon) return null;
  return (
    <Figures
      label="Мне в цифрах"
      items={[
        { label: "Просьбы ко мне", value: requests, href: "#me-requests", testId: "me-fig-requests" },
        { label: "Просьбы: срок прошёл", value: overdueRequests, href: "#me-requests", tone: "danger", testId: "me-fig-requests-late" },
        { label: "События", value: events, href: "#me-events", testId: "me-fig-events" },
        { label: "Мои задачи просрочены", value: late, href: "#me-deadlines", tone: "danger", testId: "me-fig-late" },
        { label: "Срок сегодня или завтра", value: soon, href: "#me-deadlines", tone: "warning", testId: "me-fig-soon" },
      ]}
    />
  );
}
