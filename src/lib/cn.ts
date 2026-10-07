import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { ANIMATIONS, CONTAINERS, LEADINGS, RADII, SHADOWS, TEXT_SIZES } from "./design-tokens";

// Свои токены нужно назвать склейке классов: иначе text-caption она примет за цвет текста
// и выбросит его рядом с text-muted
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: Object.keys(TEXT_SIZES),
      shadow: [...SHADOWS],
      leading: [...LEADINGS],
      container: [...CONTAINERS],
      animate: [...ANIMATIONS],
      radius: [...RADII],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
