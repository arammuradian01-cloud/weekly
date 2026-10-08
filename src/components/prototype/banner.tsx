import { FlaskConical, Megaphone } from "lucide-react";
import type { StandBanner } from "@/lib/admin/service";

/**
 * Плашка над страницами (дизайн-система: system/StandBanner.jsx, sv-stand). Вид выбирает владелец в настройках:
 * тестовый стенд до пилота, пилот на время первой недели работы команды, потом без плашки
 */
export function PrototypeBanner({ mode, ownerName }: { mode: StandBanner; ownerName: string | null }) {
  if (mode === "off") return null;
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
        </p>
      </div>
    );
  }
  return (
    <div className="sv-stand">
      <FlaskConical className="h-4 w-4 shrink-0 text-warning" strokeWidth={1.5} aria-hidden="true" />
      <p>
        <strong>Тестовый стенд.</strong> Bord остаётся главным: ресурс забирает из него задачи и ничего в него не пишет. Задачи, weekly и настройки сохраняются в базе ресурса.
      </p>
    </div>
  );
}
