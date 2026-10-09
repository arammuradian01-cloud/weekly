import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { currentActor } from "@/lib/action-runner";
import { TaskRuleError } from "@/lib/tasks/service";
import { applyLeaderBoard, canLoadLeaderBoard, LEADER_FILE_MAX, LEADER_MANAGE_ONLY, previewLeaderBoard, tabsFromXlsx } from "@/lib/goals/leader-board-service";

export const dynamic = "force-dynamic";

/**
 * Цели квартала из файла борда лидера (этап 31). Файл .xlsx приходит формой и читается в памяти, на диск и в базу
 * не попадает. mode=preview показывает план, mode=apply записывает его. Права проверяются до чтения файла:
 * загружают владелец и администраторы в режиме управления
 */
export async function POST(request: Request) {
  try {
    // Запрос только со страницы ресурса: чужой сайт не отправит форму от имени вошедшего человека
    const origin = request.headers.get("origin");
    if (origin && !sameSite(origin, request.url)) return NextResponse.json({ ok: false, error: "Запрос с чужого сайта" }, { status: 403 });
    const actor = await currentActor();
    if (!canLoadLeaderBoard(actor)) return NextResponse.json({ ok: false, error: LEADER_MANAGE_ONLY }, { status: 403 });
    // Размер по заголовку до чтения тела: большой файл не держим в памяти
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > LEADER_FILE_MAX + 64 * 1024) return NextResponse.json({ ok: false, error: TOO_BIG }, { status: 413 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return NextResponse.json({ ok: false, error: "Выберите файл борда в формате .xlsx" });
    if (file.size > LEADER_FILE_MAX) return NextResponse.json({ ok: false, error: TOO_BIG }, { status: 413 });
    const opts = { team: String(form.get("team") ?? ""), quarter: String(form.get("quarter") ?? "") || null };
    const tabs = await tabsFromXlsx(await file.arrayBuffer());
    const value = form.get("mode") === "apply" ? await applyLeaderBoard(actor, tabs, { ...opts, file: file.name.replace(/\.xlsx$/i, "") }) : await previewLeaderBoard(actor, tabs, opts);
    return NextResponse.json({ ok: true, value }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof TaskRuleError) return NextResponse.json({ ok: false, error: error.message });
    // Содержимое файла в лог не пишем: в борде бывают личные данные
    console.error("Цели из борда лидера: не прошло", error instanceof Error ? error.message : "ошибка");
    return NextResponse.json({ ok: false, error: "Не получилось прочитать файл. Обновите страницу и попробуйте ещё раз" });
  }
}

const TOO_BIG = "Файл больше 9 МБ: удалите из копии борда лишние вкладки и скачайте снова";

function sameSite(origin: string, url: string): boolean {
  if (origin === process.env.APP_URL?.replace(/\/+$/, "")) return true;
  try {
    return new URL(origin).host === new URL(url).host;
  } catch {
    return false;
  }
}
