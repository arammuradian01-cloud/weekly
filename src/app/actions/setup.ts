"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/settings";
import {
  PASSWORD_SETTING_KEYS,
  hashPassword,
  validateNewPassword,
  verifyPassword,
  type PasswordKind,
} from "@/lib/passwords";
import { computeLockState, historySince } from "@/lib/rate-limit";
import { formatTime } from "@/lib/week";
import { requestIp } from "@/lib/auth";
import { clearSetupCode, missingPasswords, setupCodeMatches, setupEnabled } from "@/lib/setup-status";

export type SetupState = { error?: string } | null;

const KINDS: PasswordKind[] = ["team", "owner", "admin"];
const TITLES: Record<PasswordKind, string> = {
  team: "общего входа",
  owner: "владельца",
  admin: "администраторов",
};

export async function completeSetup(_prev: SetupState, formData: FormData): Promise<SetupState> {
  if (!(await setupEnabled())) {
    return { error: "Первичная настройка выключена: перезапустите приложение, и в журнале запуска появится новый код" };
  }

  const missing = await missingPasswords();
  if (missing.length === 0) redirect("/login");

  const ip = await requestIp();
  const now = new Date();
  const attempts = await prisma.loginAttempt.findMany({
    where: { ip, kind: "TEAM", at: { gte: historySince(now) } },
    select: { at: true, ok: true, blocked: true },
  });
  const lock = computeLockState(attempts.filter((a) => !a.blocked), now);
  if (lock.locked && lock.lockedUntil) {
    return { error: `Слишком много неверных попыток. Попробовать снова можно в ${formatTime(lock.lockedUntil)}` };
  }

  if (!(await setupCodeMatches(String(formData.get("token") ?? "")))) {
    await prisma.loginAttempt.create({ data: { ip, kind: "TEAM", ok: false } });
    await writeAudit({ action: "setup.fail", ip });
    return { error: `Неверный код настройки. Осталось попыток: ${Math.max(0, lock.remaining - 1)}` };
  }

  const fresh: Partial<Record<PasswordKind, string>> = {};
  for (const kind of missing) {
    const password = String(formData.get(kind) ?? "");
    const repeat = String(formData.get(`${kind}-repeat`) ?? "");
    const problem = validateNewPassword(password);
    if (problem) return { error: `Пароль ${TITLES[kind]}: ${problem.toLowerCase()}` };
    if (password !== repeat) return { error: `Пароль ${TITLES[kind]}: повтор не совпал` };
    fresh[kind] = password;
  }

  // Все три пароля должны различаться: и новые между собой, и с уже заданными
  const values = Object.values(fresh);
  if (new Set(values).size !== values.length) return { error: "Пароли должны отличаться друг от друга" };
  for (const kind of KINDS) {
    if (missing.includes(kind)) continue;
    const hash = await getSetting<string | null>(PASSWORD_SETTING_KEYS[kind], null);
    for (const v of values) {
      if (await verifyPassword(v, hash)) return { error: `Один из паролей совпадает с паролем ${TITLES[kind]}` };
    }
  }

  for (const kind of missing) {
    await setSetting(PASSWORD_SETTING_KEYS[kind], await hashPassword(fresh[kind]!));
    const epochKey = kind === "team" ? "auth.epoch" : "auth.managementEpoch";
    await setSetting(epochKey, (await getSetting<number>(epochKey, 1)) + 1);
    await writeAudit({ action: "password.set", ip, after: { kind, via: "setup" } });
  }
  await clearSetupCode();
  await prisma.loginAttempt.create({ data: { ip, kind: "TEAM", ok: true } });
  redirect("/login?setup=done");
}
