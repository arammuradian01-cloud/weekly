"use client";

// Редактор отчёта по смысловым блокам (этап 66): отчёт CEO, черновик weekly для CEO в разборе встречи и weekly команды.
// Каждый блок карточкой: строки с продуктом, текстом и ссылкой на источник, «Добавить строку». Блок можно поднять,
// опустить, скрыть и собрать заново из источников. В «Продуктах» строки по подразделам продуктов. Состояние держит
// родитель: редактор только показывает блоки и сообщает правки. Цифры недели и месяца живые, пока их не поправили руками:
// поправленный блок помечен, а если цифры с тех пор обновились, редактор предлагает собрать блок заново.

import { ArrowDown, ArrowUp, ExternalLink, Eye, EyeOff, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { addLine, defaultProduct, moveBlock, patchLine, removeLine, setHidden } from "@/lib/weekly-blocks/edit";
import { BLOCK_LIMITS, LIVE_FIGURE_KEYS, NUMBERS_HIDDEN_TEXT, labelOf, lineText, productGroups, type BlockLine, type Labels, type ProductRef, type ReportBlock } from "@/lib/weekly-blocks/types";

const external = (href: string) => /^https?:\/\//.test(href);
const rowsFor = (text: string) => Math.min(6, Math.max(1, Math.ceil(text.length / 72) + (text.includes("\n") ? 1 : 0)));

type Props = {
  blocks: ReportBlock[];
  onChange: (next: ReportBlock[]) => void;
  products: readonly ProductRef[];
  labels: Labels;
  order: readonly string[];
  idPrefix: string;
  readOnly?: boolean;
  /** Блоки не двигаются и не скрываются: черновик разбора встречи раскладывается по блокам отчёта недели */
  fixedLayout?: boolean;
  /** «Собрать блок заново»: родитель спрашивает подтверждение и берёт строки из свежей автосборки */
  onRebuild?: (key: string) => void;
  /** Отчёт прошлой недели для сравнения: под каждым блоком его строки */
  compare?: { number: number; blocks: ReportBlock[] } | null;
  headingLevel?: 2 | 3;
};

export function BlocksEditor({ blocks, onChange, products, labels, order, idPrefix, readOnly = false, fixedLayout = false, onRebuild, compare, headingLevel = 2 }: Props) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const Sub = headingLevel === 2 ? "h3" : "h4";
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`${idPrefix}-editor`}>
      {blocks.map((b, bi) => {
        const id = `${idPrefix}-${b.key.replace(":", "-")}`;
        const prev = compare?.blocks.find((x) => x.key === b.key);
        const row = (line: BlockLine, index: number, n: number) =>
          // Вместо цифр, которых зритель не видит: строка только для чтения, при сохранении цифры возвращаются на место
          !line.href && line.text === NUMBERS_HIDDEN_TEXT ? (
            <li key={index} className="text-small text-muted" data-testid="block-line-hidden">
              {NUMBERS_HIDDEN_TEXT}
            </li>
          ) : (
            <LineRow
              key={index}
              line={line}
              n={n}
              id={`${id}-l${index}`}
              block={b}
              products={products}
              labels={labels}
              readOnly={readOnly}
              onPatch={(patch) => onChange(patchLine(blocks, b.key, index, patch))}
              onRemove={() => onChange(removeLine(blocks, b.key, index))}
            />
          );
        return (
          <section key={b.key} aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3 sv-card sv-card--soft px-4 py-4 sm:px-5", b.hidden && "opacity-80")} data-testid={`${idPrefix}-block-${b.key}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <H id={id} className="text-title-sm font-semibold text-ink">
                  {b.title}
                </H>
                {b.hidden ? (
                  <p className="mt-0.5 text-caption text-muted" data-testid="block-hidden">
                    Скрыт: в отчёт не попадёт{b.note ? `. ${b.note}` : ""}
                  </p>
                ) : b.note ? (
                  <p className="mt-0.5 text-caption text-muted">{b.note}</p>
                ) : null}
                {!readOnly && b.edited && LIVE_FIGURE_KEYS.includes(b.key) && !b.stale ? (
                  <p className="mt-0.5 text-caption text-muted" data-testid="block-edited">
                    Цифры поправлены руками и сами не обновляются
                  </p>
                ) : null}
              </div>
              {!readOnly && !fixedLayout ? (
                <div className="flex flex-wrap items-center gap-1">
                  <Button type="button" size="sm" variant="ghost" aria-label={`Поднять блок «${b.title}»`} disabled={bi === 0} onClick={() => onChange(moveBlock(blocks, b.key, -1))}>
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" aria-label={`Опустить блок «${b.title}»`} disabled={bi === blocks.length - 1} onClick={() => onChange(moveBlock(blocks, b.key, 1))}>
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" aria-label={`${b.hidden ? "Показать" : "Скрыть"} блок «${b.title}»`} onClick={() => onChange(setHidden(blocks, b.key, !b.hidden))}>
                    {b.hidden ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
                    {b.hidden ? "Показать" : "Скрыть"}
                  </Button>
                  {onRebuild ? (
                    <Button type="button" size="sm" variant="ghost" aria-label={`Собрать блок «${b.title}» заново`} onClick={() => onRebuild(b.key)}>
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {b.stale && !readOnly && onRebuild ? (
              <div className="flex flex-col gap-2 rounded-lg bg-warning-soft px-3.5 py-2.5 text-small text-warning-ink sm:flex-row sm:items-center sm:justify-between" role="status" data-testid="block-stale">
                <p>Цифры обновились, а этот блок поправлен руками. Пересобрать его по свежим цифрам?</p>
                <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => onRebuild(b.key)}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Пересобрать
                </Button>
              </div>
            ) : null}
            {b.hidden ? null : (
              <>
                {b.lines.length ? (
                  b.key === "products" ? (
                    <div className="flex flex-col gap-3">
                      {productGroups(b.lines, order).map((g) => (
                        <div key={g.product ?? "-"} className="flex min-w-0 flex-col gap-2">
                          <Sub className="text-body font-semibold text-ink">{labelOf(g.product, labels) ?? "Без продукта"}</Sub>
                          <ul className="flex flex-col gap-2">{g.items.map((it) => row(it.line, it.index, it.index + 1))}</ul>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ul className="flex flex-col gap-2">{b.lines.map((l, i) => row(l, i, i + 1))}</ul>
                  )
                ) : (
                  <p className="text-small text-muted">Строк нет</p>
                )}
                {!readOnly && b.lines.length < BLOCK_LIMITS.lines ? (
                  <div>
                    <Button type="button" size="sm" variant="soft" onClick={() => onChange(addLine(blocks, b.key, defaultProduct(b.key, products)))}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Добавить строку
                    </Button>
                  </div>
                ) : null}
              </>
            )}
            {compare ? (
              <div className="rounded-lg bg-field px-3.5 py-2.5" data-testid="block-previous">
                <p className="text-caption font-medium text-muted">Неделя {compare.number}</p>
                {prev && !prev.hidden && prev.lines.length ? (
                  <ul className="mt-1 flex flex-col gap-1 text-small text-ink">
                    {prev.lines.map((l, i) => (
                      <li key={i} className="break-words">
                        - {lineText(l, labels)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-small text-muted">Блок был пустым</p>
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function LineRow({
  line,
  n,
  id,
  block,
  products,
  labels,
  readOnly,
  onPatch,
  onRemove,
}: {
  line: BlockLine;
  n: number;
  id: string;
  block: ReportBlock;
  products: readonly ProductRef[];
  labels: Labels;
  readOnly: boolean;
  onPatch: (patch: Partial<BlockLine>) => void;
  onRemove: () => void;
}) {
  const options = products.map((p) => ({ value: p.code, label: p.label }));
  if (line.product && !options.some((o) => o.value === line.product)) options.push({ value: line.product, label: `${labelOf(line.product, labels)} (скрыто)` });
  if (!line.product) options.unshift({ value: "", label: "Без продукта" });
  const where = `строка ${n} блока «${block.title}»`;
  return (
    <li className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start" data-testid="block-line">
      <div className="flex items-center gap-2 sm:contents">
        <label htmlFor={`${id}-p`} className="sr-only">
          Продукт, {where}
        </label>
        <select id={`${id}-p`} className="sv-control min-w-0 flex-1 sm:w-44 sm:flex-none" value={line.product ?? ""} disabled={readOnly} onChange={(e) => onPatch({ product: e.target.value || null })}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {!readOnly ? (
          <Button type="button" size="sm" variant="ghost" className="shrink-0 sm:order-last" aria-label={`Убрать ${where}`} onClick={onRemove}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={`${id}-t`} className="sr-only">
          Текст, {where}
        </label>
        <textarea
          id={`${id}-t`}
          className="sv-control min-h-11 w-full"
          rows={rowsFor(line.text)}
          value={line.text}
          maxLength={BLOCK_LIMITS.text}
          readOnly={readOnly}
          placeholder="Что важно знать CEO, с цифрой"
          onChange={(e) => onPatch({ text: e.target.value })}
        />
        {line.href ? (
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-caption text-muted">
            <span>Источник:</span>
            <a href={line.href} {...(external(line.href) ? { target: "_blank", rel: "noreferrer" } : {})} className="inline-flex min-w-0 items-center gap-1 font-medium text-link hover:underline">
              <span className="truncate">{line.source || "ссылка"}</span>
              {external(line.href) ? <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
            </a>
            {!readOnly ? (
              <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-field hover:text-ink" aria-label={`Убрать ссылку, ${where}`} onClick={() => onPatch({ href: null })}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}
