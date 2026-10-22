import Link from "next/link";
import { FlaskConical, Megaphone } from "lucide-react";
import type { StandBanner } from "@/lib/admin/service";

/** Где владелец меняет вид плашки: раздел настроек «Плашка и данные» */
const SWITCH_HREF = "/settings#stand";

/**
 * Плашка над страницами (дизайн-система: system/StandBanner.jsx, sv-stand). Вид выбирает владелец в настройках:
 * тестовый стенд до пилота, пилот на время первой недели работы команды, потом без плашки.
 * Этап 59 (С5): текст для всех человеческим языком и без противоречий со Справкой; про Bord и устройство стенда
 * плашка не говорит. Ссылка на смену вида только владельцу: остальным она ничего не даёт
 */
export function PrototypeBanner({ mode, ownerName, canSwitch = false }: { mode: StandBanner; ownerName: string | null; canSwitch?: boolean }) {
  if (mode === "off") return null;
  const owner = canSwitch ? (
    <>
      {" "}
      <Link href={SWITCH_HREF} className="font-medium underline underline-offset-2" data-testid="stand-switch">
        Сменить плашку
      </Link>
    </>
  ) : null;
  if (mode === "pilot") {
    return (
      <div className="sv-stand bg-info-soft text-info-ink">
        <Megaphone className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <p>
          <strong>Пилот.</strong> Weekly и задачи ведём здесь, таблица обновляется сама.{" "}
          <a href="/help" className="font-medium underline underline-offset-2">
            Как работать
          </a>
          {ownerName ? `. Замечания и ошибки присылайте владельцу ресурса (${ownerName}).` : "."}
          {owner}
        </p>
      </div>
    );
  }
  return (
    <div className="sv-stand">
      <FlaskConical className="h-4 w-4 shrink-0 text-warning" strokeWidth={1.5} aria-hidden="true" />
      <p>
        <strong>Тестовый стенд.</strong> Здесь пробуем Weekly до пилота: задачи и weekly сохраняются, но перед пилотом их могут загрузить заново.{" "}
        <a href="/help" className="font-medium underline underline-offset-2">
          Как работать
        </a>
        .{owner}
      </p>
    </div>
  );
}
