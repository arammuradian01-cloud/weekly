"use client";

// Переключатель версий раздела «Рынок» (этап 79): старая версия (окно с дашбордом из пакета) и новая (обычные страницы
// приложения, /market?v=2). Вкладка и фильтры живут в адресе и меняются без перезагрузки, поэтому ссылка
// собирается при нажатии из текущего адреса: та же вкладка с теми же фильтрами открывается в другой версии.

import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";

/** Адрес другой версии: v=2 добавляется или убирается, остальное как есть */
export function otherVersionHref(search: string, to: "new" | "old"): string {
  const q = new URLSearchParams(search);
  if (to === "new") q.set("v", "2");
  else q.delete("v");
  const s = q.toString();
  return `/market${s ? `?${s}` : ""}`;
}

export function VersionLink({ to, initialSearch }: { to: "new" | "old"; initialSearch: string }) {
  const router = useRouter();
  const href = otherVersionHref(initialSearch, to);
  return (
    <a
      href={href}
      className={buttonClass("secondary", "sm")}
      data-testid={to === "new" ? "market-version-new" : "market-version-old"}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        router.push(otherVersionHref(window.location.search, to));
      }}
    >
      {to === "new" ? "Новая версия" : "Старая версия"}
    </a>
  );
}
