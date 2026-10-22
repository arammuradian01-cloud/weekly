"use client";

// Липкая панель внизу экрана и тост (этап 59, С7). Панель («Назад, Дальше» встречи, выбранные задачи) регистрируется,
// и, пока она у низа экрана, в переменной --sticky-bottom на <html> лежит расстояние от низа экрана до её верхнего края.
// Место тостов (.sv-toaster) встаёт выше этого края и не ложится на кнопки панели. Панель в середине страницы тост не
// поднимает. Панелей может быть несколько: берётся самая высокая у низа. Ушла панель, тост опускается на место

import { useEffect, type RefObject } from "react";

/** Панель, чей нижний край ближе к низу экрана, чем эта величина, может попасть под тост: тост встаёт над ней */
export const STICKY_ZONE = 200;

const panels = new Set<HTMLElement>();
let frame = 0;

/** Расстояние от низа экрана до верхнего края самой высокой панели у низа или 0 */
export function stickyOffset(rects: { top: number; bottom: number; height: number }[], viewport: number): number {
  let top = 0;
  for (const r of rects) {
    if (r.height <= 0 || r.top >= viewport || viewport - r.bottom > STICKY_ZONE) continue;
    top = Math.max(top, viewport - r.top);
  }
  return Math.ceil(top);
}

function measure() {
  frame = 0;
  const offset = stickyOffset([...panels].map((el) => el.getBoundingClientRect()), window.innerHeight);
  const root = document.documentElement;
  if (offset > 0) root.style.setProperty("--sticky-bottom", `${offset}px`);
  else root.style.removeProperty("--sticky-bottom");
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(measure);
}

/** Панель у низа экрана поднимает тост над собой, пока она на странице и active */
export function useStickyBottom(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    panels.add(el);
    if (panels.size === 1) {
      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule);
    }
    // Панель меняет высоту или страница под ней становится короче и длиннее: край панели сдвигается без прокрутки
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(el);
    observer?.observe(document.body);
    measure();
    return () => {
      observer?.disconnect();
      panels.delete(el);
      if (!panels.size) {
        window.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", schedule);
      }
      measure();
    };
  }, [ref, active]);
}
