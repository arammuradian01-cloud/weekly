import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { currentActor } from "@/lib/action-runner";
import { TaskRuleError } from "@/lib/tasks/service";
import { applyLeaderBoard, LEADER_FILE_MAX, previewLeaderBoard, tabsFromXlsx } from "@/lib/goals/leader-board-service";

export const dynamic = "force-dynamic";

/**
 * Цели квартала из файла борда лидера (этап 31). Файл .xlsx приходит формой и читается в памяти, на диск и в базу
 * не попадает. mode=preview показывает план, mode=apply записывает его. Права проверяет сервис: режим управления
 */
export async function POST(request: Request) {
  // Запрос только со страницы ресурса: чужой сайт не отправит форму от имени вошедшего человека
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host && origin !== process.env.APP_URL?.replace(/\/+$/, "")) {
    return NextResponse.json({ ok: false, error: "Запрос с чужого сайта" }, { status: 403 });
  }
  try {
    const actor = await currentActor();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return NextResponse.json({ ok: false, error: "Выберите файл борда в формате .xlsx" });
    if (file.size > LEADER_FILE_MAX) return NextResponse.json({ ok: false, error: "Файл больше 15 МБ" });
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
