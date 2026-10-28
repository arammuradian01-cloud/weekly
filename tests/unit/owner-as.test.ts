// Этап 71: «Сменить профиль» без базы. Кто может войти в профиль и в чей, когда вход кончается и есть ли возврат,
// какие вкладки могут записывать во время входа и после него, вход в подписанной cookie сессии (и её продление),
// пометка журнала, выбор по общему логину, поиск людей и черновики на устройстве. Пометку в записях журнала и отказ
// режима управления во время входа проверяют настоящие действия в tests/db/owner-as.test.ts.
import { describe, expect, it } from "vitest";
import { SESSION_REFRESH_SEC, refreshSessionToken, signSession, verifySession } from "@/lib/session";
import { TaskRuleError } from "@/lib/rule-error";
import {
  OWNER_AS_ENDED,
  OWNER_AS_END_TEXTS,
  OWNER_AS_STALE,
  OWNER_AS_TEXTS,
  OWNER_AS_TTL_MS,
  ownerAsEndReason,
  ownerAsReturnable,
  ownerAsStartError,
  ownerAsTitleMark,
  ownerAsUntil,
  ownerAsWriteRefusal,
  refuseOwnerAs,
  type OwnerAsStarter,
} from "@/lib/owner-as";
import { isViewAsRefusal } from "@/lib/view-as-texts";
import { parseViewAsTab, viewAsTabState, viewAsWriteRefusal } from "@/lib/view-as";
import { auditVia } from "@/lib/audit";
import { teamChoosable } from "@/lib/org/people";
import { PEOPLE_SHOWN, filterPeople, personMatches, type SearchPerson } from "@/components/shell/people-search";
import { clearOfflineDraftsFor, putHeadlineDraft, type KeyValue } from "@/lib/offline/drafts";

const secret = "test-secret-0123456789-0123456789-abcdef";
const now = Date.UTC(2026, 9, 22, 9, 0);

const owner: OwnerAsStarter = { personId: "owner", role: "OWNER", personal: true, byEmail: false, viewing: false, inside: false };
const reva = { id: "reva", active: true, role: "LEADER" as const };

describe("кто входит в чужой профиль и в чей", () => {
  it("владелец при личном входе: в профиль включённого человека, не владельца и не себя", () => {
    expect(ownerAsStartError(owner, reva)).toBeNull();
    expect(ownerAsStartError(owner, { id: "admin", active: true, role: "ADMIN" })).toBeNull();
    expect(ownerAsStartError(owner, { id: "employee", active: true, role: "EMPLOYEE" })).toBeNull();
    expect(ownerAsStartError(owner, { id: "ceo", active: true, role: "OBSERVER" })).toBeNull();
    expect(ownerAsStartError(owner, { id: "co-owner", active: true, role: "OWNER" })).toBe(OWNER_AS_TEXTS.owner);
    expect(ownerAsStartError(owner, { ...reva, active: false })).toBe(OWNER_AS_TEXTS.inactive);
    expect(ownerAsStartError(owner, { id: "owner", active: true, role: "OWNER" })).toBe(OWNER_AS_TEXTS.self);
    expect(ownerAsStartError(owner, null)).toBe(OWNER_AS_TEXTS.missing);
  });

  it("не владелец, общий логин, вход по ссылке на почту, просмотр и уже идущий вход: отказ", () => {
    expect(ownerAsStartError({ ...owner, role: "ADMIN" }, reva)).toBe(OWNER_AS_TEXTS.ownerOnly);
    expect(ownerAsStartError({ ...owner, role: "LEADER" }, reva)).toBe(OWNER_AS_TEXTS.ownerOnly);
    expect(ownerAsStartError({ ...owner, personal: false }, reva)).toBe(OWNER_AS_TEXTS.personal);
    // Вход по ссылке на почту: доступ к одной почте прав владельца не даёт
    expect(ownerAsStartError({ ...owner, byEmail: true }, reva)).toBe(OWNER_AS_TEXTS.email);
    expect(ownerAsStartError({ ...owner, viewing: true }, reva)).toBe(OWNER_AS_TEXTS.viewing);
    // Во входе профиль человека, а не владельца: отказ про повторную смену раньше отказа про роль
    expect(ownerAsStartError({ ...owner, role: "LEADER", inside: true }, reva)).toBe(OWNER_AS_TEXTS.inside);
  });
});

describe("срок и конец входа", () => {
  const grant = { id: "as-1", targetId: "reva", until: ownerAsUntil(now) };
  const me = { id: "owner", role: "OWNER" as const, active: true };

  it("вход живёт 12 часов, как режим управления", () => {
    expect(OWNER_AS_TTL_MS).toBe(12 * 60 * 60 * 1000);
    expect(grant.until - now).toBe(OWNER_AS_TTL_MS);
    expect(ownerAsEndReason(grant, me, reva, now)).toBeNull();
    expect(ownerAsEndReason(grant, me, reva, grant.until - 1)).toBeNull();
    expect(ownerAsEndReason(grant, me, reva, grant.until)).toBe("expired");
  });

  it("снятая роль и выключенный владелец важнее срока: возврата нет", () => {
    expect(ownerAsEndReason(grant, { ...me, role: "ADMIN" }, reva, grant.until + 1)).toBe("role");
    expect(ownerAsEndReason(grant, { ...me, active: false }, reva, now)).toBe("owner");
    expect(ownerAsReturnable("role")).toBe(false);
    expect(ownerAsReturnable("owner")).toBe(false);
    expect(ownerAsReturnable("session")).toBe(false);
    expect(ownerAsReturnable("logout")).toBe(false);
  });

  it("человека выключили, удалили или сделали владельцем: вход кончается, возврат есть", () => {
    expect(ownerAsEndReason(grant, me, { ...reva, active: false }, now)).toBe("inactive");
    expect(ownerAsEndReason(grant, me, null, now)).toBe("inactive");
    expect(ownerAsEndReason(grant, me, { ...reva, role: "OWNER" }, now)).toBe("promoted");
    expect(ownerAsReturnable("expired")).toBe(true);
    expect(ownerAsReturnable("inactive")).toBe(true);
    expect(ownerAsReturnable("promoted")).toBe(true);
  });

  it("причины словами для журнала и плашки, пометка во вкладке", () => {
    expect(OWNER_AS_END_TEXTS.return).toBe("Вернулся в свой профиль");
    expect(OWNER_AS_END_TEXTS.expired).toBe("Вышел срок входа");
    expect(OWNER_AS_END_TEXTS.role).toBe("Снята роль владельца");
    expect(new Set(Object.values(OWNER_AS_END_TEXTS)).size).toBe(Object.keys(OWNER_AS_END_TEXTS).length);
    expect(ownerAsTitleMark("Рева Тарас")).toBe("Профиль Рева Тарас");
  });
});

describe("кто записывает во время входа", () => {
  it("метки вкладки входа разбираются и собираются", () => {
    expect(parseViewAsTab("as:abc-1")).toEqual({ kind: "as", id: "abc-1" });
    expect(parseViewAsTab("as-ended:abc-1")).toEqual({ kind: "as-ended", id: "abc-1" });
    expect(parseViewAsTab("as:")).toBeNull();
    expect(parseViewAsTab("as:../x")).toBeNull();
    expect(viewAsTabState({ viewing: null, ended: null, ownerAs: "abc", ownerAsEnded: null })).toBe("as:abc");
    expect(viewAsTabState({ viewing: null, ended: null, ownerAs: null, ownerAsEnded: "abc" })).toBe("as-ended:abc");
    expect(viewAsTabState({ viewing: null, ended: null })).toBe("self");
  });

  it("вход идёт: пишет только вкладка этого входа и запрос без метки", () => {
    const state = { active: "as-1", ended: null };
    expect(ownerAsWriteRefusal(state, { kind: "as", id: "as-1" })).toBeNull();
    expect(ownerAsWriteRefusal(state, null)).toBeNull();
    // Вкладка, показанная до входа, от имени владельца: её правка ушла бы от имени человека
    expect(ownerAsWriteRefusal(state, { kind: "self" })).toBe(OWNER_AS_STALE);
    expect(ownerAsWriteRefusal(state, { kind: "as", id: "as-0" })).toBe(OWNER_AS_STALE);
    expect(ownerAsWriteRefusal(state, { kind: "view", id: "v" })).toBe(OWNER_AS_STALE);
    expect(ownerAsWriteRefusal(state, { kind: "as-ended", id: "as-1" })).toBe(OWNER_AS_STALE);
  });

  it("вход закончился сам: отказ из любой вкладки, пока владелец не вернётся", () => {
    const state = { active: null, ended: "as-1" };
    for (const tab of [null, { kind: "self" as const }, { kind: "as" as const, id: "as-1" }, { kind: "as-ended" as const, id: "as-1" }]) expect(ownerAsWriteRefusal(state, tab)).toBe(OWNER_AS_ENDED);
  });

  it("входа нет: вкладка, оставшаяся от входа, отказ; остальное по правилу «Смотреть как»", () => {
    const none = { active: null, ended: null };
    expect(ownerAsWriteRefusal(none, { kind: "as", id: "as-1" })).toBe(OWNER_AS_STALE);
    expect(ownerAsWriteRefusal(none, { kind: "as-ended", id: "as-1" })).toBe(OWNER_AS_STALE);
    expect(ownerAsWriteRefusal(none, { kind: "self" })).toBeNull();
    expect(ownerAsWriteRefusal(none, null)).toBeNull();
    // Правило просмотра метку входа не принимает за свою и не блокирует
    expect(viewAsWriteRefusal({ viewing: null, ended: null }, { kind: "as", id: "as-1" })).toBeNull();
  });

  it("отказы входа не выбрасывают черновик с устройства", () => {
    expect(isViewAsRefusal(OWNER_AS_STALE)).toBe(true);
    expect(isViewAsRefusal(OWNER_AS_ENDED)).toBe(true);
    expect(isViewAsRefusal(OWNER_AS_TEXTS.account)).toBe(false);
  });

  it("учётная запись человека во входе владельца: отказ ошибкой правила", () => {
    expect(() => refuseOwnerAs({ via: "OWNER_AS" })).toThrow(TaskRuleError);
    expect(() => refuseOwnerAs({ via: "OWNER_AS" })).toThrow(OWNER_AS_TEXTS.account);
    expect(() => refuseOwnerAs({ via: "PASSWORD" })).not.toThrow();
    expect(() => refuseOwnerAs({ via: "TEAM" })).not.toThrow();
    expect(() => refuseOwnerAs({ via: null })).not.toThrow();
  });
});

describe("вход в подписанной cookie сессии", () => {
  it("подпись и проверка сохраняют вход, продление cookie его не продлевает", async () => {
    const data = { epoch: 3, personId: "owner", sid: "device-1", via: "PASSWORD" as const, ownerAs: { id: "as-1", targetId: "reva", until: now + 1000 } };
    const token = await signSession(data, secret, now);
    expect(await verifySession(token, secret, now)).toEqual(data);
    const later = now + (SESSION_REFRESH_SEC + 60) * 1000;
    const fresh = await refreshSessionToken(token, secret, later);
    expect(fresh).not.toBeNull();
    expect((await verifySession(fresh!, secret, later))?.ownerAs).toEqual(data.ownerAs);
  });

  it("неполный вход в cookie не принимается", async () => {
    for (const ownerAs of [{ id: "", targetId: "reva", until: now }, { id: "x", targetId: 5, until: now }, { id: "x", targetId: "reva" }, "as-1"]) {
      const token = await signSession({ epoch: 1, personId: "owner", sid: "d", ownerAs } as never, secret, now);
      expect((await verifySession(token, secret, now))?.ownerAs).toBeUndefined();
    }
  });
});

describe("пометка журнала и выбор по общему логину", () => {
  it("auditVia: способ входа и кто из владельцев вошёл", () => {
    expect(auditVia({ via: "OWNER_AS", asOwner: { id: "o", fullName: "Мурадян Арам" } })).toEqual({ via: "OWNER_AS", asOwnerId: "o", asOwnerName: "Мурадян Арам" });
    expect(auditVia({ via: "PASSWORD" })).toEqual({ via: "PASSWORD", asOwnerId: null, asOwnerName: null });
    expect(auditVia({})).toEqual({ via: null, asOwnerId: null, asOwnerName: null });
  });

  it("общий логин: включённые люди без личного пароля, владелец без пароля тоже (поправка 23.10)", () => {
    const p = { active: true, passwordHash: null };
    expect(teamChoosable(p)).toBe(true);
    expect(teamChoosable({ ...p, passwordHash: "$2b$12$hash" })).toBe(false);
    expect(teamChoosable({ ...p, active: false })).toBe(false);
  });
});

describe("поиск людей и черновики на устройстве", () => {
  it("поиск по ФИО, должности и подразделению, сразу первые 100", () => {
    const people: SearchPerson[] = Array.from({ length: 250 }, (_, i) => ({ id: `p${i}`, fullName: `Сотрудник ${String(i).padStart(3, "0")}`, position: i === 7 ? "Product Owner ОСАГО" : "Аналитик", unit: i === 9 ? "Управление продуктов" : null }));
    const all = filterPeople(people, "");
    expect(all.shown).toHaveLength(PEOPLE_SHOWN);
    expect(all.more).toBe(150);
    expect(filterPeople(people, "осаго").shown.map((p) => p.id)).toEqual(["p7"]);
    expect(filterPeople(people, "управление прод").shown.map((p) => p.id)).toEqual(["p9"]);
    expect(personMatches({ id: "x", fullName: "Фёдоров Пётр", position: null, unit: null }, "федоров")).toBe(true);
  });

  it("возврат стирает черновики только того человека, в чей профиль входили", () => {
    const data = new Map<string, string>();
    const kv: KeyValue = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, String(v)),
      removeItem: (k) => void data.delete(k),
      key: (i) => [...data.keys()][i] ?? null,
      get length() {
        return data.size;
      },
    };
    putHeadlineDraft("reva", "2026-10-19", "Неделя пилотов", "", now, kv);
    putHeadlineDraft("muradyan", "2026-10-19", "Свой черновик владельца", "", now, kv);
    clearOfflineDraftsFor("reva", kv);
    expect([...data.keys()]).toEqual(["weekly-offline:v1:muradyan"]);
  });
});
