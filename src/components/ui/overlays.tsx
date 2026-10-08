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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className={cn(
            "sv-drawer fixed inset-y-0 right-0 z-50 w-full rounded-none outline-none data-[state=open]:animate-slide-in sm:rounded-l-panel",
            wide ? "sm:max-w-[720px]" : "sm:max-w-[560px]",
          )}
        >
          <div className="sv-drawer__head px-5 sm:px-6">
            <div className="sv-drawer__head__main">
              <Dialog.Title className="sv-drawer__title">{title}</Dialog.Title>
              {description ? <Dialog.Description className="text-caption text-text-secondary">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Подробности</Dialog.Description>}
            </div>
            <div className="sv-drawer__actions">
              <Dialog.Close className="sv-icon-btn sv-icon-btn--sm" aria-label="Закрыть">
                <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
              </Dialog.Close>
            </div>
          </div>
          <div className="sv-drawer__body min-h-0 px-5 sm:px-6">{children}</div>
          {footer ? <div className="sv-drawer__foot px-5 sm:px-6">{footer}</div> : null}
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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-panel bg-surface p-5 shadow-medium outline-none sm:px-6 sm:py-5", wide ? "max-w-[760px]" : "max-w-[560px]")}>
          <Dialog.Title className="sv-modal__title block">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="mt-1 text-body text-text-secondary">{description}</Dialog.Description>
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
  ariaSubject,
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
  /** Чьё значение, для экранного диктора, когда таких полей на экране несколько: «задачи 47» */
  ariaSubject?: string;
}) {
  const current = renderValue ?? render;
  if (disabled) return <span className="inline-flex min-h-7 items-center">{current(value)}</span>;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${label}${ariaSubject ? ` ${ariaSubject}` : ""}: ${valueLabel ?? options.find((o) => o.value === value)?.label ?? value}. Изменить`}
        className="sv-inline-edit group data-[state=open]:border-focus data-[state=open]:bg-field"
      >
        {current(value)}
        <ChevronDown className="sv-inline-edit__chev h-3.5 w-3.5 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100" strokeWidth={1.75} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align={align}
          sideOffset={4}
          className="z-50 min-w-48 rounded-control-lg border border-line bg-surface p-1.5 shadow-medium"
        >
          <Menu.Label className="sv-menu__group">{label}</Menu.Label>
          {options.map((o) => (
            <Menu.Item
              key={o.value}
              onSelect={() => o.value !== value && onChange(o.value)}
              className={cn("sv-menu__item cursor-pointer select-none justify-between outline-none data-[highlighted]:bg-field", o.value === value && "!bg-accent-soft")}
            >
              {render(o.value)}
              {o.value === value ? <Check className="sv-menu__item__check h-[18px] w-[18px] text-link" strokeWidth={1.75} aria-hidden="true" /> : null}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
