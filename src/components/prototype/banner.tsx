import { FlaskConical, Megaphone } from "lucide-react";
import type { StandBanner } from "@/lib/admin/service";

/**
 * Плашка над страницами. Вид выбирает владелец в настройках:
 * тестовый стенд до пилота, пилот на время первой недели работы команды, потом без плашки
 */
export function PrototypeBanner({ mode, ownerName }: { mode: StandBanner; ownerName: string | null }) {
  if (mode === "off") return null;
  if (mode === "pilot") {
    return (
      <div className="flex items-center gap-2.5 border-b border-blue/20 bg-blue-soft px-4 py-2 text-[13px] text-blue-700 sm:px-6 lg:px-10">
        <Megaphone className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-semibold">Пилот.</span> Weekly и задачи ведём здесь, таблица обновляется сама.{" "}
          <a href="/help" className="font-medium underline underline-offset-2">
            Как работать
          </a>
          {ownerName ? `. Замечания и ошибки присылайте владельцу ресурса (${ownerName}).` : "."}
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 border-b border-[#f0dfa6] bg-warning-soft px-4 py-2 text-[13px] text-warning-ink sm:px-6 lg:px-10">
      <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">Тестовый стенд.</span> Задачи, weekly и настройки сохраняются в базе ресурса. В Google-таблицу они уходят только в копию, рабочая таблица Insurance&Invest Bord не подключена.
      </p>
    </div>
  );
}
