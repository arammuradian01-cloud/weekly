import { FlaskConical } from "lucide-react";

/** Плашка прототипа этапа 2: чтобы никто не принял выдуманные задачи за настоящие */
export function PrototypeBanner() {
  return (
    <div className="flex items-center gap-2.5 border-b border-[#f0dfa6] bg-warning-soft px-4 py-2 text-[13px] text-warning-ink sm:px-6 lg:px-10">
      <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">Прототип.</span> Данные выдуманные, изменения пропадут после обновления страницы.
      </p>
    </div>
  );
}
