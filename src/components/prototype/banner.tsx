import { FlaskConical } from "lucide-react";

/** Плашка тестового стенда: что уже сохраняется, а что ещё прототип */
export function PrototypeBanner() {
  return (
    <div className="flex items-center gap-2.5 border-b border-[#f0dfa6] bg-warning-soft px-4 py-2 text-[13px] text-warning-ink sm:px-6 lg:px-10">
      <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">Тестовый стенд.</span> Задачи и weekly сохраняются в базе ресурса, в Google-таблицу пока не уходят. Экран «Настройки» пока образец: его правки не сохраняются.
      </p>
    </div>
  );
}
