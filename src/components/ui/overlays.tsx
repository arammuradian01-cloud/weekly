"use client";

// Боковая панель, диалог и выбор значения в строке. Всё на Radix: фокус, Esc и чтение экранными дикторами работают сами.

import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-navy/30 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-drawer outline-none data-[state=open]:animate-slide-in",
            wide ? "sm:max-w-[720px]" : "sm:max-w-[560px]",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-title font-semibold leading-snug text-ink">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 text-small text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Подробности</Dialog.Description>}
            </div>
            <Dialog.Close className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-ink" aria-label="Закрыть">
              <X className="h-5 w-5" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
          {footer ? <div className="border-t border-line px-5 py-3 sm:px-6">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Широкое окно: списки с полями в несколько колонок (приём из Notion, этап 23) */
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-navy/30" />
        <Dialog.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] -translate-x-1/2", wide ? "max-w-[760px]" : "max-w-[480px]", " -translate-y-1/2 overflow-y-auto overscroll-contain rounded-xl bg-surface p-5 shadow-modal outline-none sm:p-6")}>
          <Dialog.Title className="text-title font-semibold text-ink">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="mt-1 text-small text-muted">{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Выбор значения прямо в строке таблицы: статус, состояние, приоритет. Один клик открывает список.
 * Если менять нельзя, показывается только метка.
 */
export function InlineSelect<V extends string>({
  value,
  options,
  onChange,
  render,
  renderValue,
  label,
  valueLabel,
  disabled,
  align = "start",
}: {
  value: V;
  options: { value: V; label: string }[];
  onChange: (value: V) => void;
  render: (value: V) => React.ReactNode;
  /** Текущее значение в строке, если оно показывается иначе, чем вариант в списке (например, «не подтверждено») */
  renderValue?: (value: V) => React.ReactNode;
  label: string;
  /** Подпись текущего значения, если его нет среди вариантов (например, «Не задан») */
  valueLabel?: string;
  disabled?: boolean;
  align?: "start" | "end";
}) {
  const current = renderValue ?? render;
  if (disabled) return <span className="inline-flex min-h-9 items-center">{current(value)}</span>;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${label}: ${valueLabel ?? options.find((o) => o.value === value)?.label ?? value}. Изменить`}
        className="group -mx-1.5 inline-flex min-h-9 items-center gap-1 rounded-md px-1.5 hover:bg-field data-[state=open]:bg-field"
      >
        {current(value)}
        <ChevronDown className="h-3.5 w-3.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align={align}
          sideOffset={4}
          className="z-50 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-menu"
        >
          <Menu.Label className="px-2.5 pb-1 pt-1.5 text-tiny text-muted">{label}</Menu.Label>
          {options.map((o) => (
            <Menu.Item
              key={o.value}
              onSelect={() => o.value !== value && onChange(o.value)}
              className="flex h-10 cursor-pointer select-none items-center justify-between gap-3 rounded-md px-2.5 outline-none data-[highlighted]:bg-field"
            >
              {render(o.value)}
              {o.value === value ? <Check className="h-4 w-4 text-blue-700" aria-hidden="true" /> : null}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
