import { describe, expect, it } from "vitest";
import { computeLockState, LOCK_MS, type Attempt } from "@/lib/rate-limit";

const t0 = new Date("2026-10-04T18:00:00Z").getTime();
const min = 60_000;
const fail = (m: number): Attempt => ({ at: new Date(t0 + m * min), ok: false });
const ok = (m: number): Attempt => ({ at: new Date(t0 + m * min), ok: true });
const now = (m: number) => new Date(t0 + m * min);

describe("блокировка подбора пароля", () => {
  it("четыре ошибки ещё не блокируют, остаётся одна попытка", () => {
    const s = computeLockState([fail(0), fail(1), fail(2), fail(3)], now(4));
    expect(s).toMatchObject({ locked: false, remaining: 1 });
  });

  it("пятая ошибка закрывает вход на 15 минут от неё", () => {
    const s = computeLockState([fail(0), fail(1), fail(2), fail(3), fail(4)], now(5));
    expect(s.locked).toBe(true);
    expect(s.lockedUntil?.getTime()).toBe(t0 + 4 * min + LOCK_MS);
  });

  it("через 15 минут вход открывается и счёт начинается заново", () => {
    const s = computeLockState([fail(0), fail(1), fail(2), fail(3), fail(4)], now(19.5));
    expect(s).toMatchObject({ locked: false, remaining: 5 });
  });

  it("успешный вход обнуляет счёт ошибок", () => {
    const s = computeLockState([fail(0), fail(1), fail(2), fail(3), ok(4), fail(5)], now(6));
    expect(s).toMatchObject({ locked: false, remaining: 4 });
  });

  it("ошибки старше 15 минут не считаются", () => {
    const s = computeLockState([fail(0), fail(1), fail(2), fail(3), fail(20)], now(21));
    expect(s).toMatchObject({ locked: false, remaining: 4 });
  });

  it("попытки во время блокировки её не продлевают", () => {
    const attempts = [fail(0), fail(1), fail(2), fail(3), fail(4), fail(10), fail(18)];
    const during = computeLockState(attempts, now(18.5));
    expect(during.lockedUntil?.getTime()).toBe(t0 + 4 * min + LOCK_MS);
    const after = computeLockState(attempts, now(19.5));
    expect(after).toMatchObject({ locked: false, remaining: 5 });
  });
});
