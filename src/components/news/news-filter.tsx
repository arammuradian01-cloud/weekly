"use client";

// Ряд продуктов над лентой новостей (этап 59). На телефоне ряд в одну строку прокручивается вбок, поэтому выбранный
// продукт может оказаться за краем: при заходе и при смене продукта ряд прокручивается так, чтобы он был виден

import { useEffect, useRef } from "react";

export function NewsFilter({ active, children }: { /** Ключ выбранного продукта: при смене ряд снова доводит его до видимости */ active: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [active]);
  return (
    <nav ref={ref} aria-label="Продукты" className="sv-pills sv-pills--phone-scroll mb-5" data-testid="news-filter">
      {children}
    </nav>
  );
}
