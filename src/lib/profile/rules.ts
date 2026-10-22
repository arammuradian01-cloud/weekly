// Фото и «О себе» в профиле (этап 80): правила без базы и без Node. Их берут обработчики загрузки, служба профиля,
// экраны и модульные тесты. Тип файла определяется по первым байтам содержимого, а не по имени и не по заголовку
// браузера: переименованный файл или подмена Content-Type не проходят.

import { TaskRuleError } from "@/lib/rule-error";

/** Файл не стал фото: текст для человека как есть (обработчик отвечает 415) */
export class AvatarError extends TaskRuleError {}

/** Входной файл фото не больше 10 МБ: снимок телефона в JPEG обычно 2-6 МБ */
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
export const AVATAR_MAX_LABEL = "10 МБ";
/** Картинка больше 50 мегапикселей не разбирается: защита памяти сервера от «бомб» (маленький файл, огромная картинка) */
export const AVATAR_MAX_PIXELS = 50_000_000;
/** Стороны готовых картинок: крупная для карточки, мелкая для списков */
export const AVATAR_LARGE = 256;
export const AVATAR_SMALL = 64;
/** Что принимает поле выбора файла. HEIC не перечислен нарочно: тогда iPhone сам отдаёт снимок в JPEG */
export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";

export const ABOUT_MAX = 500;
export const HELP_MAX = 300;

export type ImageKind = "jpeg" | "png" | "webp" | "heic" | "avif" | "gif" | "bmp" | "tiff" | "svg" | "pdf";
/** Форматы, которые ресурс превращает в фото профиля */
export const AVATAR_KINDS: ImageKind[] = ["jpeg", "png", "webp"];

export const PROFILE_TEXTS = {
  signedOut: "Вход закончился: обновите страницу, войдите и загрузите фото снова",
  tooBig: `Файл больше ${AVATAR_MAX_LABEL}: выберите фото поменьше или сожмите его`,
  empty: "Файл пустой: выберите фото ещё раз",
  failed: "Не получилось сохранить фото, попробуйте ещё раз",
  wrongType: "Это не фото в формате JPEG, PNG или WebP. Выберите другой файл",
  heic: "Фото в формате HEIC сервер не читает. Сохраните его как JPEG (на iPhone: Настройки, Камера, Форматы, «Наиболее совместимый») или сделайте снимок экрана",
  broken: "Файл повреждён или это не фото: откройте его на устройстве и сохраните заново",
  hugePixels: "Фото слишком большое по числу точек: уменьшите его до 50 мегапикселей и загрузите снова",
  tooSmall: "Фото слишком маленькое: нужно хотя бы 32 точки по каждой стороне",
  tooMany: "Слишком много загрузок фото подряд: попробуйте через несколько минут",
  teamLogin: "Фото и «О себе» меняются при личном входе: по общему логину можно выбрать чужой профиль",
  personalOnly: "Фото и «О себе» меняет сам человек при своём личном входе",
  notYours: "Фото и «О себе» коллеги меняет только он сам или владелец в режиме управления",
  noPerson: "Такого человека нет в ресурсе",
  noPhoto: "Фото уже убрано: обновите страницу",
  avatarSignedOut: "Фото коллег видно только после входа в ресурс",
  avatarMissing: "Фото нет",
  telegram: "Ник в Telegram: от 5 до 32 знаков, латинские буквы, цифры и подчёркивание, первым идёт буква. Например, @ivan_petrov",
} as const;

/** Тип картинки по первым байтам файла или null, если это не картинка известного вида */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const b = bytes;
  const at = (i: number) => b[i] ?? -1;
  const ascii = (from: number, text: string) => [...text].every((c, i) => at(from + i) === c.charCodeAt(0));
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => at(i) === v)) return "png";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "gif";
  if (ascii(0, "BM") && b.length > 26) return "bmp";
  if ((ascii(0, "II") && at(2) === 42 && at(3) === 0) || (ascii(0, "MM") && at(2) === 0 && at(3) === 42)) return "tiff";
  if (ascii(0, "%PDF")) return "pdf";
  // ISO BMFF: размер блока, затем «ftyp» и основной бренд. HEIC и AVIF устроены одинаково, различаются брендом
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(at(8), at(9), at(10), at(11));
    if (brand === "avif" || brand === "avis") return "avif";
    if (["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "heic";
    return null;
  }
  // SVG: текст с тегом svg в начале (после пробелов, BOM, объявления XML или комментария)
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 512)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg")) || (head.startsWith("<!--") && head.includes("<svg"))) return "svg";
  return null;
}

/** Что сказать человеку про тип файла: null, если файл подходит */
export function imageKindRefusal(kind: ImageKind | null): string | null {
  if (kind && AVATAR_KINDS.includes(kind)) return null;
  if (kind === "heic") return PROFILE_TEXTS.heic;
  return PROFILE_TEXTS.wrongType;
}

/** Размер файла: пустой и больше предела не принимаются. null: размер подходит */
export function imageSizeRefusal(bytes: number): string | null {
  if (bytes <= 0) return PROFILE_TEXTS.empty;
  if (bytes > AVATAR_MAX_BYTES) return PROFILE_TEXTS.tooBig;
  return null;
}

/**
 * Текст для поля, которое видят все: переносы строк Windows и старых Mac приводятся к \n, неразрывные и прочие
 * пробелы к обычному, служебные символы убираются (кроме переноса строки), пробелы в конце строк и пустые строки по
 * краям обрезаются, больше одной пустой строки подряд не остаётся. Пустой текст: null
 */
export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000\t]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, "")
    .split("\n")
    .map((line) => line.replace(/ +$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text : null;
}

/** Длина для предела поля: как считает поле ввода в браузере (maxLength), по единицам UTF-16 */
export const textLength = (text: string | null) => (text ? text.length : 0);

/**
 * Ник в Telegram из того, что вписал человек: @name, name, t.me/name или https://t.me/name. Возвращает ник без @ или
 * null, если поле пустое. Неверный ник: ошибка с примером
 */
export function parseTelegram(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: PROFILE_TEXTS.telegram };
  const raw = value.trim();
  if (!raw) return { ok: true, value: null };
  const nick = raw
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");
  // Правила Telegram: 5-32 знака, латиница, цифры и подчёркивание, первая буква, в конце не подчёркивание, без «__»
  if (!/^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/.test(nick) || nick.includes("__")) return { ok: false, error: PROFILE_TEXTS.telegram };
  return { ok: true, value: nick };
}

/** Ссылка на ник в Telegram */
export const telegramUrl = (nick: string) => `https://t.me/${encodeURIComponent(nick)}`;

export type ProfileAbout = { about: string | null; helpWith: string | null; telegram: string | null };

/** Поля «О себе» из формы: тексты почищены, ник проверен. Ошибка: первая непройденная проверка словами */
export function parseAbout(input: unknown): { ok: true; value: ProfileAbout } | { ok: false; error: string } {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const about = cleanText(raw.about);
  const helpWith = cleanText(raw.helpWith);
  if (textLength(about) > ABOUT_MAX) return { ok: false, error: `«О себе» длиннее ${ABOUT_MAX} знаков: сократите на ${textLength(about) - ABOUT_MAX}` };
  if (textLength(helpWith) > HELP_MAX) return { ok: false, error: `«Чем могу помочь коллегам» длиннее ${HELP_MAX} знаков: сократите на ${textLength(helpWith) - HELP_MAX}` };
  const telegram = parseTelegram(raw.telegram);
  if (!telegram.ok) return telegram;
  return { ok: true, value: { about, helpWith, telegram: telegram.value } };
}

/** Подписи полей для журнала и экранов */
export const ABOUT_LABELS: Record<keyof ProfileAbout, string> = {
  about: "О себе",
  helpWith: "Чем могу помочь коллегам",
  telegram: "Telegram",
};

/** Кто правит профиль: тот, кто действует, и как он вошёл */
export type ProfileEditor = { personId: string; role: string; management: string | null; via?: string | null };

/** Личный вход: свой логин и пароль, ссылка на почту или приглашение. Общий логин и чужие способы (вход владельца в чужой профиль) не в счёт */
const PERSONAL_VIA = new Set(["PASSWORD", "EMAIL", "INVITE"]);

/**
 * Можно ли менять фото и «О себе» человека targetId. Сам человек при личном входе, владелец при личном входе в режиме
 * управления (например, убрать неподходящее фото). По общему логину нельзя никому: там можно выбрать чужой профиль.
 * Любой другой способ входа (этап 71: владелец вошёл в чужой профиль) тоже нет: список личных входов закрытый.
 * Режим «Смотреть как» отказывает раньше, в проверке записи. null: можно
 */
export function profileEditRefusal(editor: ProfileEditor, targetId: string): string | null {
  if (editor.via === "TEAM") return PROFILE_TEXTS.teamLogin;
  if (!editor.via || !PERSONAL_VIA.has(editor.via)) return PROFILE_TEXTS.personalOnly;
  if (editor.personId === targetId) return null;
  if (editor.role === "OWNER" && editor.management === "OWNER") return null;
  return PROFILE_TEXTS.notYours;
}

export type PhotoAnswer = { ok: true; version: number } | { ok: false; error: string };

/**
 * Ответ обработчика загрузки фото в браузере: версия нового фото или понятный текст. Текст ошибки сервера (JSON
 * {ok:false, error}) показывается как есть, ответ не JSON разбирается по статусу (401 вход закончился, 413 файл
 * больше предела), остальное общим текстом
 */
export async function readPhotoAnswer(res: Response): Promise<PhotoAnswer> {
  if (res.redirected) return { ok: false, error: PROFILE_TEXTS.signedOut };
  const json = (res.headers.get("content-type") ?? "").includes("application/json");
  const body = json ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : null;
  if (body && typeof body === "object") {
    const value = body.value as { version?: unknown } | undefined;
    if (res.ok && body.ok === true && typeof value?.version === "number") return { ok: true, version: value.version };
    if (body.ok === false && typeof body.error === "string" && body.error.trim()) return { ok: false, error: body.error };
  }
  if (res.status === 401) return { ok: false, error: PROFILE_TEXTS.signedOut };
  if (res.status === 413) return { ok: false, error: PROFILE_TEXTS.tooBig };
  return { ok: false, error: PROFILE_TEXTS.failed };
}

/** Проверка файла в браузере до отправки, по размеру и заявленному типу: сервер всё равно проверит по содержимому */
export function pickedFileRefusal(file: { size: number; type: string; name: string }): string | null {
  const size = imageSizeRefusal(file.size);
  if (size) return size;
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif" || /\.hei[cf]$/i.test(file.name)) return PROFILE_TEXTS.heic;
  // Тип пустой у некоторых браузеров и файловых менеджеров: решит сервер
  if (type && !AVATAR_ACCEPT.split(",").includes(type)) return PROFILE_TEXTS.wrongType;
  return null;
}
