import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { loadRegistry } from "@/lib/registry";
import { structureView } from "@/lib/org/view";
import { peopleTree } from "@/lib/org/people-tree";

import { teamsView, focusTeam } from "@/lib/org/teams";
import { teamAnalytics } from "@/lib/analytics/service";
import { actorFor, taskHistory, taskLinks } from "@/lib/tasks/service";
import { ensureWeek, upcomingAbsences } from "@/lib/weekly/service";

const prefix = "registry93-";
let activeId: string;
let inactiveId: string;
beforeAll(async () => {
  const active = await prisma.person.create({ data: { slug: `${prefix}active`, fullName: "Действующий Человек", shortName: "Человек", zone: "", role: "EMPLOYEE" } });
  const inactive = await prisma.person.create({ data: { slug: `${prefix}inactive`, fullName: "Прежний Администратор", shortName: "Администратор", zone: "", role: "ADMIN", active: false } });
  activeId = active.id; inactiveId = inactive.id;
  await prisma.team.create({ data: { id: `${prefix}hidden`, name: "Закрытая команда 93", kind: "CUSTOM", leaderId: inactiveId } });
  await prisma.team.create({ data: { id: `${prefix}visible`, name: "Открытая команда 93", kind: "CUSTOM", parentId: `${prefix}hidden`, leaderId: inactiveId, members: { create: [{ personId: activeId }, { personId: inactiveId }] } } });
});
afterAll(async () => {
  await prisma.task.deleteMany({ where: { number: { in: [939301, 939302, 939303] } } });
  await prisma.team.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.person.deleteMany({ where: { slug: { startsWith: prefix } } });
  await prisma.$disconnect();
});

describe("публичный справочник", () => {
  it("не сериализует роли, выключенных людей и скрытые связи команд", async () => {
    const result = await loadRegistry({ management: false, visibleTeams: [`${prefix}visible`] });
    expect(result.people.find((p) => p.slug === `${prefix}active`)).toMatchObject({ fullName: "Действующий Человек" });
    for (const p of result.people) {
      expect(p).not.toHaveProperty("role");
      expect(p).not.toHaveProperty("active");
    }
    expect(JSON.stringify(result)).not.toContain(`${prefix}inactive`);
    expect(JSON.stringify(result)).not.toContain(`${prefix}hidden`);
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0]).toMatchObject({ parent: null, leader: null, members: [`${prefix}active`] });
  });
  it("полный снимок существует только при явно переданном управлении", async () => {
    const result = await loadRegistry({ management: true, visibleTeams: [] });
    expect(result.people.find((p) => p.slug === `${prefix}inactive`)).toMatchObject({ role: "ADMIN", active: false });
    expect(result.teams.some((t) => t.id === `${prefix}hidden`)).toBe(true);
  });
  it("страница структуры и дерево людей не обходят ограничение", async () => {
    const viewer = { id: activeId, role: "EMPLOYEE" as const };
    const structure = await structureView(viewer);
    expect(structure.teams.some((t) => t.id === `${prefix}hidden`)).toBe(false);
    expect(structure.teams.find((t) => t.id === `${prefix}visible`)).toMatchObject({ parentId: null, leader: null });
    for (const p of [...structure.units.flatMap((u) => u.people), ...structure.unplaced]) expect(p).not.toHaveProperty("role");
    const tree = await peopleTree(viewer);
    expect(JSON.stringify(tree)).not.toContain(`${prefix}hidden`);
  });
  it("прямой адрес команды, её родитель и отключённый руководитель не обходят доступ", async () => {
    const actor = await actorFor(`${prefix}active`);
    const list = await teamsView(actor);
    const focused = await focusTeam(actor, `${prefix}visible`);
    expect(focused).toMatchObject({ parent: null, leader: null });
    expect(JSON.stringify(list)).not.toContain(`${prefix}hidden`);
    expect(JSON.stringify(list)).not.toContain(`${prefix}inactive`);
    expect(await focusTeam(actor, `${prefix}hidden`)).toBeNull();
    expect(await focusTeam(await actorFor("muradyan", "OWNER"), `${prefix}hidden`)).not.toBeNull();
  });
  it("аналитика не раскрывает техническую роль или состояние отключённого лидера", async () => {
    await prisma.team.update({ where: { id: `${prefix}hidden` }, data: { leaderId: activeId } });
    try {
    const viewer = await actorFor("muradyan");
    const subject = { id: viewer.personId, role: viewer.role };
    const publicView = await teamAnalytics(subject, `${prefix}hidden`);
    expect(publicView).not.toBeNull();
    expect(publicView!.leaders).toHaveLength(1);
    expect(JSON.stringify(publicView)).not.toContain("Прежний Администратор");
    for (const card of publicView!.leaders) {
      if (card.leader) {
        expect(card.leader).not.toHaveProperty("active");
        expect(card.leader).not.toHaveProperty("note");
      }
    }
    const managed = await teamAnalytics(subject, `${prefix}hidden`, new Date(), true);
    expect(managed!.leaders.some((c) => c.leader?.note === "выключен в ресурсе")).toBe(true);
    } finally {
      await prisma.team.update({ where: { id: `${prefix}hidden` }, data: { leaderId: inactiveId } });
    }
  });
  it("история, видимая зависимость и отсутствие сохраняют только подпись прежнего сотрудника", async () => {
    const direction = await prisma.dictionaryItem.findFirstOrThrow({ where: { kind: "DIRECTION", active: true } });
    const make = (number: number, teamId: string, ownerId: string) => prisma.task.create({ data: {
      number, title: `Проверка ${number}`, outcome: "Результат", directionId: direction.id,
      due: new Date("2026-11-30"), whereUpdatedAt: new Date(), teamId, ownerId,
    } });
    const main = await make(939301, `${prefix}visible`, activeId);
    const visible = await make(939302, `${prefix}visible`, inactiveId);
    const hidden = await make(939303, `${prefix}hidden`, inactiveId);
    await prisma.taskDependency.createMany({ data: [visible, hidden].map((t) => ({ taskId: main.id, blockerId: t.id })) });
    await prisma.auditLog.create({ data: { entity: "task", entityId: String(main.number), action: "task.update", actorId: inactiveId, field: "Статус" } });
    const label = { slug: `${prefix}inactive`, fullName: "Прежний Администратор", shortName: "Администратор" };
    expect((await taskHistory(main.number))[0].peopleLabels).toEqual([label]);
    const links = await taskLinks(await actorFor(`${prefix}active`), main.number);
    expect(links!.waitsFor.find((t) => t.number === visible.number)!.peopleLabels).toEqual([label]);
    expect(links!.waitsFor.find((t) => t.number === hidden.number)).toMatchObject({ owner: null, title: null, peopleLabels: [] });
    const week = await ensureWeek(prisma, "2026-11-09");
    await prisma.absence.create({ data: { personId: activeId, weekId: week.id, substituteId: inactiveId } });
    expect((await upcomingAbsences(activeId, new Date("2026-11-09T12:00:00Z")))[0].peopleLabels).toEqual([label]);
  });

  it("списки добавления людей скрывают отключённых руководителей текущих связей", async () => {
    const unit = await prisma.orgUnit.create({ data: { name: "Проверка справочника 93", kind: "DEPARTMENT", headId: inactiveId } });
    await prisma.person.update({ where: { id: activeId }, data: { managerId: inactiveId, unitId: unit.id } });
    await prisma.team.update({ where: { id: `${prefix}visible` }, data: { leaderId: activeId } });
    try {
      const personal = await teamsView(await actorFor(`${prefix}active`));
      expect(personal.people.find((p) => p.slug === `${prefix}active`)).toMatchObject({ manager: null });
      expect(personal.units.find((u) => u.id === unit.id)).toMatchObject({ head: null });
      const managed = await teamsView(await actorFor("muradyan", "OWNER"));
      expect(managed.people.find((p) => p.slug === `${prefix}active`)).toMatchObject({ manager: `${prefix}inactive` });
      expect(managed.units.find((u) => u.id === unit.id)).toMatchObject({ head: `${prefix}inactive` });
    } finally {
      await prisma.person.update({ where: { id: activeId }, data: { managerId: null, unitId: null } });
      await prisma.team.update({ where: { id: `${prefix}visible` }, data: { leaderId: inactiveId } });
      await prisma.orgUnit.delete({ where: { id: unit.id } });
    }
  });

});
