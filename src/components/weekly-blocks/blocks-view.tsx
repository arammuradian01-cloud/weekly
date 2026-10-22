// Отчёт по смысловым блокам только для чтения (этап 66): так CEO видит отправленный weekly, так выглядит предпросмотр
// в редакторе отчёта CEO, в разборе встречи и в weekly команды. Скрытые и пустые блоки не показываются. В «Продуктах»
// подраздел на каждый продукт, в остальных блоках продукт меткой перед строкой. У строки ссылка на источник. Без
// состояния: подходит и серверу, и клиенту. Подписи продуктов приходят параметром: на сервере справочник экрана может
// быть ещё не подменён снимком из базы.

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { labelOf, lineText, productGroups, visibleBlocks, type BlockLine, type Labels, type ReportBlock } from "@/lib/weekly-blocks/types";

const external = (href: string) => /^https?:\/\//.test(href);

export function BlockLineView({ line, labels, product = true }: { line: BlockLine; labels: Labels; product?: boolean }) {
  const label = product ? labelOf(line.product, labels) : null;
  // Текст уже начинается с названия продукта («ОСАГО: ...»): метку второй раз не ставим
  const tag = label && lineText(line, labels) !== line.text ? label : null;
  return (
    <li className="break-words" data-testid="block-line-view">
      {tag ? (
        <Badge tone="info" className="mr-1.5 align-baseline">
          {tag}
        </Badge>
      ) : null}
      <span>{line.text}</span>
      {line.href ? (
        <>
          {" "}
          <a
            href={line.href}
            {...(external(line.href) ? { target: "_blank", rel: "noreferrer" } : {})}
            className="inline-flex items-center gap-1 whitespace-nowrap text-small font-medium text-link hover:underline"
          >
            {line.source || "Источник"}
            {external(line.href) ? <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> : null}
          </a>
        </>
      ) : null}
    </li>
  );
}

export function BlocksView({
  blocks,
  labels,
  order,
  idPrefix,
  headingLevel = 3,
  className,
}: {
  blocks: readonly ReportBlock[];
  labels: Labels;
  order: readonly string[];
  idPrefix: string;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const Sub = headingLevel === 2 ? "h3" : "h4";
  const shown = visibleBlocks(blocks);
  if (!shown.length) return <p className="text-body text-muted">В отчёте пока нет ни одной строки.</p>;
  return (
    <div className={cn("flex min-w-0 flex-col gap-5", className)}>
      {shown.map((b) => {
        const id = `${idPrefix}-${b.key.replace(":", "-")}`;
        return (
          <section key={b.key} aria-labelledby={id} className="min-w-0" data-testid={`${idPrefix}-block-${b.key}`}>
            <H id={id} className="text-title-sm font-semibold text-ink">
              {b.title}
            </H>
            {b.note && (b.key === "wow" || b.key === "month") ? <p className="mt-0.5 text-caption text-muted">{b.note}</p> : null}
            {b.key === "products" ? (
              <div className="mt-2 flex flex-col gap-3">
                {productGroups(b.lines, order).map((g) => (
                  <div key={g.product ?? "-"} className="min-w-0">
                    <Sub className="text-body font-semibold text-ink">{labelOf(g.product, labels) ?? "Без продукта"}</Sub>
                    <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-body text-ink">
                      {g.items.map((i) => (
                        <BlockLineView key={i.index} line={i.line} labels={labels} product={false} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5 text-body text-ink">
                {b.lines.map((l, i) => (
                  <BlockLineView key={i} line={l} labels={labels} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
