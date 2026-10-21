// Блок новостей своего продукта на главной «Моя неделя» (этап 60): серверный компонент, пять свежих новостей
// по продуктам человека (выбор в профиле или направление из карточки). Без новостей блок не показывается

import { newsDirections, newsForPerson } from "@/lib/news/service";
import { Section } from "@/components/page-header";
import { NewsCard } from "./news-list";

export async function NewsBlock({ personId }: { personId: string }) {
  const { items, directions } = await newsForPerson(personId, 5);
  if (!items.length) return null;
  const labels = new Map((await newsDirections()).map((d) => [d.code, d.label]));
  const names = directions.map((c) => labels.get(c) ?? c);
  const hint = names.length > 3 ? "по вашим продуктам" : names.join(", ");
  return (
    <Section title="Новости" hint={hint} link={{ href: "/news?d=my", label: "Все новости" }} className="mt-8" id="news">
      <div className="sv-card divide-y divide-line px-4" data-testid="home-news">
        {items.map((item) => (
          <NewsCard key={item.id} item={item} labels={labels} compact />
        ))}
      </div>
    </Section>
  );
}
