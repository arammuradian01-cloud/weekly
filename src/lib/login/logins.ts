// Логины людей (этап 52). Решение Арама 21.10: логин это первая буква имени и фамилия латиницей, например amuradyan.
// ФИО в ресурсе пишется «Фамилия Имя Отчество». Совпало с чужим логином или коротким именем: добавляется номер,
// amuradyan2. Входить можно по логину, по прежнему короткому имени (reva) и по подтверждённой почте.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/** Логины, занятые ресурсом: общий логин, «Все лидеры», события системы. Общий логин можно переименовать в настройках */
export const RESERVED_LOGINS = ["team", "all", "system", "admin"];

const MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  // Казахские, узбекские и таджикские буквы: без них логины таких имён выходили бы искажёнными
  ә: "a", ғ: "g", қ: "k", ң: "n", ө: "o", ұ: "u", ү: "u", һ: "h", і: "i", ў: "u", ҳ: "h", ҷ: "j", ӣ: "i", ӯ: "u",
};

/** Латиница из слова: только буквы a-z, остальное выкидывается */
function latin(word: string): string {
  return [...word.toLowerCase()].map((ch) => MAP[ch] ?? ch).join("").replace(/[^a-z]/g, "");
}

export const LOGIN_MAX = 30;

/** Логин без учёта занятых: первая буква имени и фамилия. Одно слово в ФИО: само слово */
export function baseLogin(fullName: string): string {
  const words = fullName.replace(/\(.*?\)/g, " ").split(/\s+/).filter(Boolean);
  const surname = latin(words[0] ?? "");
  const name = latin(words[1] ?? "");
  const login = (name ? name[0] + surname : surname).slice(0, LOGIN_MAX);
  // Логин не короче двух букв: так его примет и проверка логина, который правит владелец
  if (!login) return "user";
  return login.length < 2 ? `${login}user` : login;
}

/** Свободный логин: к занятому добавляется номер, начиная с 2. busy: занят ли логин кем-то другим */
export function freeLogin(base: string, busy: (login: string) => boolean): string {
  if (!busy(base)) return base;
  for (let i = 2; ; i += 1) {
    const next = `${base.slice(0, LOGIN_MAX - String(i).length)}${i}`;
    if (!busy(next)) return next;
  }
}

/** Проверка логина, который задаёт владелец руками. null: подходит */
export function loginProblem(value: string): string | null {
  if (!/^[a-z][a-z0-9._-]{1,29}$/.test(value)) return "Логин: от 2 до 30 символов, латинские буквы, цифры, точка, дефис или подчёркивание, начинается с буквы";
  return null;
}

type Db = PrismaClient | Prisma.TransactionClient;

/** Занятые ресурсом логины с учётом переименованного общего логина */
export async function reservedLogins(db: Db): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: "auth.team.login" } });
  const team = typeof row?.value === "string" ? row.value.trim().toLowerCase() : "";
  return [...new Set([...RESERVED_LOGINS, ...(team ? [team] : [])])];
}

/** Строки, которые нельзя дать новому человеку как короткое имя: чужие короткие имена и логины (этап 52) */
export function takenNames(people: { slug: string; login: string | null }[]): string[] {
  return people.flatMap((p) => (p.login ? [p.slug, p.login] : [p.slug]));
}

/**
 * Логины всем, у кого их ещё нет. Занятыми считаются чужие логины и чужие короткие имена: логин одного человека не
 * должен совпасть с коротким именем другого, иначе вход по нему стал бы неоднозначным. Возвращает, сколько выдано
 */
export async function fillMissingLogins(db: Db): Promise<number> {
  // Два параллельных добавления людей (или два запуска сида) не выдают один логин: внутри транзакции под замком,
  // снаружи одной транзакцией со своим замком
  if (!("$transaction" in db)) return fillMissingLoginsTx(db);
  return (db as PrismaClient).$transaction((tx) => fillMissingLoginsTx(tx), { timeout: 60_000 });
}

async function fillMissingLoginsTx(db: Prisma.TransactionClient): Promise<number> {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('people-logins'))::text`;
  const people = await db.person.findMany({ select: { id: true, slug: true, login: true, fullName: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const missing = people.filter((p) => !p.login);
  if (!missing.length) return 0;
  const reserved = new Set(await reservedLogins(db));
  // Кому принадлежит строка как логин или как короткое имя: своё короткое имя логину не мешает (у reva логин может
  // совпасть с reva), чужое мешает
  const owners = new Map<string, Set<string>>();
  const own = (value: string, id: string) => owners.set(value, (owners.get(value) ?? new Set()).add(id));
  for (const p of people) {
    own(p.slug, p.id);
    if (p.login) own(p.login, p.id);
  }
  for (const p of missing) {
    const busy = (value: string) => reserved.has(value) || [...(owners.get(value) ?? [])].some((id) => id !== p.id);
    const login = freeLogin(baseLogin(p.fullName), busy);
    own(login, p.id);
    await db.person.update({ where: { id: p.id }, data: { login } });
  }
  return missing.length;
}
