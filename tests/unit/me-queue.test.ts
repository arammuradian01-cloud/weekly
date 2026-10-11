// Этап 44: очередь «Мне» по срочности. Задачи делятся на «срок прошёл» и «сегодня или завтра», просьбы на четыре группы
import { describe, expect, it } from "vitest";
import { hotTasks, meFigureLabels, splitRequests, withoutRequestEvents } from "@/components/inbox/me-tasks";
import type { RequestView } from "@/domain/requests";
import type { Task } from "@/domain/types";

const today = "2026-10-11";

const task = (patch: Partial<Task>): Task => ({
  number: 1,
  title: "Задача",
  outcome: "",
  owner: "reva",
  coExecutors: [],
  direction: "department",
  priority: "unset",
  status: "in-progress",
  state: "on-track",
  where: "",
  whereUpdatedAt: today,
  due: "2026-10-20",
  originalDue: "2026-10-20",
  transfers: [],
  source: { kind: "other", note: "" },
  links: [],
  comments: [],
  history: [],
  createdBy: "reva",
  createdAt: today,
  updatedAt: today,
  team: "top",
  ...patch,
});

const request = (patch: Partial<RequestView>): RequestView => ({
  number: 1,
  status: "open",
  text: "Просьба",
  author: "loginova",
  addressee: "reva",
  due: "2026-10-20",
  acceptedDue: null,
  answer: null,
  task: null,
  entry: null,
  resultTask: null,
  createdAt: today,
  answeredAt: null,
  closedAt: null,
  remindedAt: null,
  stuck: false,
  overdue: false,
  can: { accept: true, decline: true, done: false, toTask: true, withdraw: false, remind: false },
  ...patch,
});

describe("мои задачи для «Мне»", () => {
  it("просроченные и сегодня-завтра, по сроку, только мои открытые", () => {
    const data = {
      today,
      tasks: [
        task({ number: 1, due: "2026-10-12" }),
        task({ number: 2, due: "2026-10-01" }),
        task({ number: 3, due: "2026-10-11" }),
        task({ number: 4, due: "2026-10-13" }),
        task({ number: 5, due: "2026-10-01", status: "done" }),
        task({ number: 6, due: "2026-10-01", owner: "golovkin" }),
        task({ number: 7, due: "2026-10-05", status: "proposed" }),
        task({ number: 8, due: "2026-10-02", archived: true }),
      ],
    };
    const hot = hotTasks(data, { slug: "reva", role: "LEADER" });
    expect(hot.late.map((t) => t.number)).toEqual([2, 7]);
    expect(hot.soon.map((t) => t.number)).toEqual([3, 1]);
  });
});

describe("просьбы ко мне по группам", () => {
  it("срок прошёл, сегодня и завтра, ответить, принятые позже", () => {
    const incoming = [
      request({ number: 1, status: "accepted", acceptedDue: "2026-10-01", overdue: true }),
      request({ number: 2, status: "open", due: "2026-10-05", overdue: true }),
      request({ number: 3, status: "accepted", acceptedDue: "2026-10-12" }),
      request({ number: 4, status: "open", due: "2026-10-12" }),
      request({ number: 5, status: "accepted", acceptedDue: "2026-10-30" }),
    ];
    const groups = splitRequests(incoming, today);
    expect(groups.late.map((r) => r.number)).toEqual([1, 2]);
    expect(groups.soon.map((r) => r.number)).toEqual([3]);
    // Открытая просьба со сроком завтра всё равно ждёт ответа: действие одно, ответить
    expect(groups.answer.map((r) => r.number)).toEqual([4]);
    expect(groups.later.map((r) => r.number)).toEqual([5]);
    // Каждая просьба ровно в одной группе
    expect([...groups.late, ...groups.soon, ...groups.answer, ...groups.later]).toHaveLength(incoming.length);
  });
});

describe("строка цифр и события", () => {
  it("подписи согласуются с числом", () => {
    expect(meFigureLabels({ late: 13, soon: 1, answer: 2, events: 5 })).toEqual({ late: "просрочено", soon: "срок сегодня или завтра", answer: "просьбы ждут ответа", events: "событий" });
    expect(meFigureLabels({ late: 0, soon: 3, answer: 1, events: 21 }).soon).toBe("срока сегодня или завтра");
    expect(meFigureLabels({ late: 0, soon: 3, answer: 1, events: 21 }).answer).toBe("просьба ждёт ответа");
    expect(meFigureLabels({ late: 0, soon: 3, answer: 1, events: 21 }).events).toBe("событие");
  });
  it("событие о просьбе, которая уже в очереди, не показывается второй раз", () => {
    const items = [{ requestNumber: 7 }, { requestNumber: null }, { requestNumber: 9 }];
    expect(withoutRequestEvents(items, [{ number: 7 }])).toEqual([{ requestNumber: null }, { requestNumber: 9 }]);
    expect(withoutRequestEvents(items, [])).toHaveLength(3);
  });
  it("принятая просьба со вчерашним сроком попадает в «срок прошёл» и без отметки сервера", () => {
    const groups = splitRequests([request({ number: 1, status: "accepted", acceptedDue: "2026-10-10", overdue: false })], today);
    expect(groups.late.map((r) => r.number)).toEqual([1]);
    expect(groups.soon).toEqual([]);
  });
});
