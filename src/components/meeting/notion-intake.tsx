"use client";

// Приём из Notion (этап 23): текст разбора встречи вставляют в окно, ресурс показывает кандидатов в задачи и решения,
// ведущий отмечает нужные, задаёт ответственного и срок, подтверждает. Ничего не создаётся без подтверждения.

import { useState } from "react";
import { FileInput } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { addDays } from "@/domain/dates";
import { dictOptions, type DirectionCode } from "@/domain/dictionaries";
import { allPeople } from "@/domain/people";
import type { PersonSlug } from "@/domain/types";
import type { MeetingView } from "@/domain/meeting";
import { intakeAction } from "@/app/(app)/meeting/actions";
import type { IntakeItem } from "@/lib/meeting/service";
import { parseNotion, type NotionCandidate } from "@/lib/meeting/notion";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { Segmented, SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { FormError } from "@/components/ui/field";
import { PersonSelect, DueField } from "@/components/requests/request-parts";

type Row = NotionCandidate & { on: boolean; owner: string; due: string; direction: string };

/** Кто имелся в виду: имя или фамилия из текста к человеку команды */
function guessOwner(who: string | undefined, fallback: string): string {
  if (!who) return fallback;
  const q = who.toLowerCase();
  const hit = allPeople().find((p) => p.fullName.toLowerCase().split(/\s+/).some((w) => w.startsWith(q.split(/\s+/)[0]!)));
  return hit?.slug ?? fallback;
}

export function NotionIntake({ meeting, onDone }: { meeting: MeetingView; onDone: (m: MeetingView) => void }) {
  const { data, me, notify } = usePrototype();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [url, setUrl] = useState(meeting.notionUrl ?? "");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const defaultDue = addDays(meeting.date, 7);
  const defaultDirection = (dictOptions("DIRECTION")[0]?.value ?? "department") as DirectionCode;

  const parse = () => {
    const found = parseNotion(text);
    if (!found.length) return setError("В тексте не нашлось строк, похожих на задачи или решения. Вставьте список из разбора встречи");
    setError(null);
    setRows(found.map((c) => ({ ...c, on: true, owner: guessOwner(c.who, me.slug), due: defaultDue, direction: me.direction ?? defaultDirection })));
  };
  const update = (key: string, patch: Partial<Row>) => setRows((prev) => prev?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? prev);

  const confirm = async () => {
    const chosen = (rows ?? []).filter((r) => r.on);
    if (!chosen.length) return setError("Отметьте, что принять");
    const items: IntakeItem[] = chosen.map((r) => (r.kind === "task" ? { kind: "task", title: r.text.slice(0, 120), owner: r.owner, due: r.due, direction: r.direction } : { kind: "decision", text: r.text, owner: r.owner || null }));
    setBusy(true);
    try {
      const res = await intakeAction(meeting.id, items, url.trim() || null);
      if (!res.ok) return setError(res.error);
      notify(`Принято: задач ${res.value.tasks.length}, решений ${res.value.decisions}`);
      onDone(res.value.meeting);
      setOpen(false);
      setRows(null);
      setText("");
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <FileInput className="h-4 w-4" aria-hidden="true" />
        Из Notion
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Приём из Notion" description="Вставьте текст разбора встречи. Ресурс покажет кандидатов в задачи и решения, вы подтвердите каждого: распознавание речи бывает неточным." wide>
        <div className="flex flex-col gap-4">
          <TextInput label="Ссылка на заметку в Notion" id="notion-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.notion.so/..." />
          {!rows ? (
            <>
              <TextArea label="Текст разбора" id="notion-text" value={text} onChange={(e) => setText(e.target.value)} rows={10} hint="Строки с «решили», «договорились» станут решениями, остальные пункты списка задачами. «@Имя» или «Имя:» в начале строки подставит ответственного" />
              <FormError message={error ?? undefined} />
              <div className="flex justify-end">
                <Button onClick={parse} disabled={!text.trim()}>
                  Разобрать
                </Button>
              </div>
            </>
          ) : (
            <>
              <ul className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto pr-1">
                {rows.map((r) => (
                  <li key={r.key} className={`flex flex-col gap-3 rounded-xl p-3 ring-1 ring-line ${r.on ? "" : "opacity-60"}`}>
                    <div className="flex flex-wrap items-start gap-3">
                      <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-body text-ink">
                        <input type="checkbox" checked={r.on} onChange={(e) => update(r.key, { on: e.target.checked })} className="h-4 w-4 accent-blue-700" />
                        Принять
                      </label>
                      <Segmented<"task" | "decision"> label={`Вид: ${r.text.slice(0, 40)}`} value={r.kind} onChange={(v) => update(r.key, { kind: v })} options={[{ value: "task", label: "Задача" }, { value: "decision", label: "Решение" }]} />
                    </div>
                    <TextInput label={r.kind === "task" ? "Задача" : "Решение"} id={`${r.key}-text`} value={r.text} onChange={(e) => update(r.key, { text: e.target.value })} maxLength={r.kind === "task" ? 120 : 1000} />
                    <div className="grid gap-3 sm:grid-cols-3">
                      <PersonSelect id={`${r.key}-owner`} label={r.kind === "task" ? "Ответственный" : "Владелец, если есть"} value={r.owner} onChange={(v) => update(r.key, { owner: v })} exclude={"" as PersonSlug} />
                      {r.kind === "task" ? (
                        <>
                          <DueField id={`${r.key}-due`} label="Срок" value={r.due} onChange={(v) => update(r.key, { due: v })} today={data.today} />
                          <SelectField label="Направление" id={`${r.key}-dir`} value={r.direction} onChange={(e) => update(r.key, { direction: e.target.value })} options={dictOptions("DIRECTION", r.direction)} />
                        </>
                      ) : null}
                    </div>
                    {r.due && r.kind === "task" ? <p className="text-caption text-muted">В тексте: «{r.due}». Проверьте срок</p> : null}
                  </li>
                ))}
              </ul>
              <FormError message={error ?? undefined} />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button type="button" variant="ghost" onClick={() => setRows(null)}>
                  К тексту
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                    Отмена
                  </Button>
                  <Button onClick={() => void confirm()} disabled={busy}>
                    {busy ? "Принимаю…" : `Принять выбранное: ${rows.filter((r) => r.on).length}`}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
