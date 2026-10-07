"use client";

import { useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, CircleHelp, Heart, MessagesSquare, SmilePlus } from "lucide-react";
import { compactName } from "@/domain/people";
import type { PersonSlug, ReactionCode, ReactionView } from "@/domain/types";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

export const REACTIONS: { code: ReactionCode; label: string; Icon: typeof Check }[] = [
  { code: "accepted", label: "Принято", Icon: Check },
  { code: "question", label: "Вопрос", Icon: CircleHelp },
  { code: "discuss", label: "Обсудить на встрече", Icon: MessagesSquare },
  { code: "thanks", label: "Спасибо", Icon: Heart },
];

const labelOf = (code: ReactionCode) => REACTIONS.find((r) => r.code === code)!.label;

/** Кто поставил реакцию: «Тарас Р., Алсу С.» */
function whoText(list: ReactionView[]): string {
  return list.map((r) => compactName(r.by)).join(", ");
}

export type ToggleReaction = (code: ReactionCode, question?: string | null) => Promise<boolean>;

/** Вопрос для «Обсудить на встрече»: без него пункт в повестку не попадает */
function QuestionForm({ id, initial, onSave, onCancel }: { id: string; initial?: string; onSave: (q: string) => Promise<boolean>; onCancel: () => void }) {
  const [text, setText] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-2 flex flex-col gap-2 rounded-lg bg-surface p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        const ok = await onSave(text.trim());
        setBusy(false);
        if (ok) onCancel();
      }}
    >
      <label htmlFor={id} className="text-sm font-medium text-ink">
        Что обсудить на встрече? Сформулируйте вопросом
      </label>
      <input
        id={id}
        value={text}
        maxLength={300}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        placeholder="Например: успеваем ли запустить до конца месяца?"
        className="h-10 w-full rounded-lg border border-line bg-white px-3 text-body text-ink focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" variant="secondary" disabled={!text.trim() || busy}>
          В повестку
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

/** Меню «Реакция»: поставить или убрать свою */
function ReactionMenu({ reactions, me, disabled, onPick }: { reactions: ReactionView[]; me: PersonSlug; disabled?: boolean; onPick: (code: ReactionCode, mine: boolean) => void }) {
  // После выбора «Обсудить на встрече» фокус уходит в поле вопроса, а не обратно на кнопку меню
  const keepFocus = useRef(false);
  return (
    <Menu.Root>
      <Menu.Trigger
        className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-caption text-muted hover:bg-surface hover:text-ink"
        aria-label="Поставить реакцию"
        disabled={disabled}
      >
        <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />
        Реакция
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="start"
          sideOffset={4}
          className="z-50 min-w-52 rounded-lg border border-line bg-white p-1 shadow-menu"
          onCloseAutoFocus={(e) => {
            if (!keepFocus.current) return;
            keepFocus.current = false;
            e.preventDefault();
          }}
        >
          {REACTIONS.map(({ code, label, Icon }) => {
            const mine = reactions.some((r) => r.kind === code && r.by === me);
            return (
              <Menu.Item
                key={code}
                onSelect={() => {
                  if (code === "discuss" && !mine) keepFocus.current = true;
                  onPick(code, mine);
                }}
                className="flex h-10 cursor-pointer select-none items-center gap-2 rounded-md px-2.5 text-small text-ink outline-none data-[highlighted]:bg-surface"
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {mine ? `Убрать «${label}»` : label}
              </Menu.Item>
            );
          })}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Реакции на запись (этап 20): четыре кнопки с числом. В ленте (compact) только поставленные реакции и меню. Повторное нажатие снимает свою реакцию.
 * «Обсудить на встрече» сначала просит вопрос. Ниже вопросы к встрече и отметка «обсуждено»
 */
export function ReactionBar({
  id,
  reactions,
  me,
  readOnly,
  onToggle,
  onDiscussed,
  canMarkDiscussed,
  large,
  compact,
}: {
  id: string;
  reactions: ReactionView[];
  me: PersonSlug;
  readOnly?: boolean;
  onToggle: ToggleReaction;
  onDiscussed?: (reactionId: string, discussed: boolean) => Promise<boolean>;
  canMarkDiscussed?: (r: ReactionView) => boolean;
  large?: boolean;
  compact?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<ReactionCode | null>(null);
  const questions = reactions.filter((r) => r.kind === "discuss");
  const press = async (code: ReactionCode) => {
    const mine = reactions.some((r) => r.kind === code && r.by === me);
    if (code === "discuss" && !mine) return setAsking(true);
    setBusy(code);
    await onToggle(code, null);
    setBusy(null);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Реакции">
        {REACTIONS.map(({ code, label, Icon }) => {
          const list = reactions.filter((r) => r.kind === code);
          const mine = list.some((r) => r.by === me);
          if ((readOnly || compact) && !list.length) return null;
          return (
            <button
              key={code}
              type="button"
              disabled={readOnly || busy !== null}
              aria-pressed={mine}
              title={list.length ? `${label}: ${whoText(list)}` : label}
              onClick={() => void press(code)}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 font-medium transition-colors disabled:cursor-default",
                large ? "text-small" : "text-caption",
                mine ? "bg-navy text-white" : "text-muted ring-1 ring-line hover:text-ink enabled:hover:ring-navy-600/40",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
              {list.length ? <span className="tabular-nums">{list.length}</span> : null}
            </button>
          );
        })}
        {compact && !readOnly ? <ReactionMenu reactions={reactions} me={me} disabled={busy !== null} onPick={(code) => void press(code)} /> : null}
      </div>
      {asking ? (
        <QuestionForm
          id={`${id}-question`}
          onCancel={() => setAsking(false)}
          onSave={async (q) => {
            setBusy("discuss");
            const ok = await onToggle("discuss", q);
            setBusy(null);
            return ok;
          }}
        />
      ) : null}
      {questions.length ? (
        <ul className="flex flex-col gap-1.5">
          {questions.map((q) => (
            <li
              key={q.id}
              className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-small", q.discussed ? "bg-surface text-muted" : "bg-warning-soft/60 text-ink")}
            >
              <MessagesSquare className="h-3.5 w-3.5 shrink-0 self-center" aria-hidden="true" />
              <span>
                <span className="font-medium">{compactName(q.by)}:</span> {q.question}
              </span>
              <span className="text-caption text-muted">{q.discussed ? "обсуждено" : "в повестке встречи"}</span>
              {onDiscussed && canMarkDiscussed?.(q) ? (
                <button type="button" className="text-caption font-semibold text-blue-700 hover:underline" onClick={() => void onDiscussed(q.id, !q.discussed)}>
                  {q.discussed ? "Вернуть в повестку" : "Обсуждено"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Реакции на комментарий: поставленные реакции с числом и меню, чтобы добавить свою. Компактно, чтобы не шуметь */
export function CommentReactions({
  id,
  reactions,
  me,
  readOnly,
  onToggle,
}: {
  id: string;
  reactions: ReactionView[];
  me: PersonSlug;
  readOnly?: boolean;
  onToggle: ToggleReaction;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggle = async (code: ReactionCode, question?: string | null) => {
    setBusy(true);
    const ok = await onToggle(code, question);
    setBusy(false);
    return ok;
  };
  const used = REACTIONS.filter((r) => reactions.some((x) => x.kind === r.code));
  const questions = reactions.filter((r) => r.kind === "discuss");
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {used.map(({ code, label, Icon }) => {
          const list = reactions.filter((r) => r.kind === code);
          const mine = list.some((r) => r.by === me);
          return (
            <button
              key={code}
              type="button"
              disabled={readOnly || busy}
              aria-pressed={mine}
              title={`${label}: ${whoText(list)}`}
              aria-label={`${label}: ${list.length}`}
              onClick={() => (code === "discuss" && !mine ? setAsking(true) : void toggle(code))}
              className={cn("inline-flex min-h-7 items-center gap-1 rounded-full px-2 text-caption font-medium", mine ? "bg-navy text-white" : "text-muted ring-1 ring-line")}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="tabular-nums">{list.length}</span>
            </button>
          );
        })}
        {readOnly ? null : (
          <ReactionMenu reactions={reactions} me={me} disabled={busy} onPick={(code, mine) => (code === "discuss" && !mine ? setAsking(true) : void toggle(code))} />
        )}
      </div>
      {asking ? <QuestionForm id={`${id}-question`} onCancel={() => setAsking(false)} onSave={(q) => toggle("discuss", q)} /> : null}
      {questions.map((q) => (
        <p key={q.id} className={cn("text-caption", q.discussed ? "text-muted" : "text-warning-ink")}>
          {labelOf("discuss")}: {q.question} ({compactName(q.by)}
          {q.discussed ? ", обсуждено" : ""})
        </p>
      ))}
    </div>
  );
}
