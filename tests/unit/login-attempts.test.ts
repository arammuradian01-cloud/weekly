import { describe, expect, it } from "vitest";
import { queuedKeys, serial, serialAll } from "@/lib/login/attempts";

// Очередь попыток входа внутри процесса (этап 29): запросы с одним ключом идут строго по одному

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

describe("очередь попыток входа", () => {
  it("запросы с одним ключом идут по одному и в порядке прихода, с разными ключами параллельно", async () => {
    const log: string[] = [];
    let running = 0;
    let peak = 0;
    const job = (key: string, name: string) =>
      serial(key, async () => {
        running += 1;
        peak = Math.max(peak, running);
        log.push(`начало ${name}`);
        await tick(3);
        log.push(`конец ${name}`);
        running -= 1;
        return name;
      });
    const results = await Promise.all([job("a", "1"), job("a", "2"), job("a", "3")]);
    expect(results).toEqual(["1", "2", "3"]);
    expect(peak).toBe(1);
    expect(log).toEqual(["начало 1", "конец 1", "начало 2", "конец 2", "начало 3", "конец 3"]);

    running = 0;
    peak = 0;
    await Promise.all([job("x", "x"), job("y", "y")]);
    expect(peak).toBe(2);
    expect(queuedKeys()).toBe(0);
  });

  it("ошибка одного запроса не ломает очередь: следующий выполняется, ключ потом убирается", async () => {
    const first = serial("b", async () => {
      await tick();
      throw new Error("база не ответила");
    });
    const second = serial("b", async () => "дальше");
    await expect(first).rejects.toThrow("база не ответила");
    await expect(second).resolves.toBe("дальше");
    expect(queuedKeys()).toBe(0);
  });

  it("несколько ключей берутся в одном порядке: встречные запросы не ждут друг друга по кругу", async () => {
    let done = 0;
    const work = async () => {
      await tick(2);
      done += 1;
    };
    // Без сортировки ключей эти два запроса могли бы ждать друг друга бесконечно
    await Promise.race([
      Promise.all([serialAll(["ip:1", "login:a"], work), serialAll(["login:a", "ip:1"], work), serialAll(["ip:1", "ip:1"], work)]),
      tick(2000).then(() => {
        throw new Error("очередь зависла");
      }),
    ]);
    expect(done).toBe(3);
    expect(queuedKeys()).toBe(0);
  });
});
