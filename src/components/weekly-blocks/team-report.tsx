"use client";

// Weekly команды по смысловым блокам (этап 66): руководитель видит отчёт своей команды, собранный по блокам шаблона из
// weekly своих людей, задач и целей команды, правит его и отправляет своему руководителю (событие в «Мне», как отправка
// CEO). Тот, кому отчёт отправили, видит отправленную версию только для чтения.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw, Save, Send } from "lucide-react";
import { usePrototype } from "@/domain/store";
import type { TeamReportView, TeamTemplateView } from "@/lib/weekly-blocks/team";
import { rebuildBlock, withoutEmptyLines } from "@/lib/weekly-blocks/edit";
import { hasBlocksText, type ReportBlock } from "@/lib/weekly-blocks/types";
import { saveTeamReportAction, sendTeamReportAction } from "@/app/(app)/weekly/blocks-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { FormError } from "@/components/ui/field";
import { Collapsible } from "@/components/ui/collapsible";
import { BlocksEditor } from "./blocks-editor";
import { BlocksView } from "./blocks-view";
import { TeamBlocksTemplate } from "./team-template";

const moment = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(" в ", ", ");

export function TeamReportScreen({ view, template }: { view: TeamReportView; template: TeamTemplateView | null }) {
  const router = useRouter();
  const { notify } = usePrototype();
  const [blocks, setBlocks] = useState<ReportBlock[]>(() => view.blocks);
  const [dirty, setDirty] = useState(!view.saved);
  const [expected, setExpected] = useState<string | null>(view.updatedAt);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [confirm, setConfirm] = useState<"rebuild" | "send" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meta = view.meta;
  const edit = (next: ReportBlock[]) => {
    setBlocks(next);
    setDirty(true);
  };

  const run = async (kind: "save" | "send") => {
    setBusy(kind);
    setError(null);
    try {
      const action = kind === "save" ? saveTeamReportAction : sendTeamReportAction;
      const r = await action(view.team.id, view.week, withoutEmptyLines(blocks), expected);
      if (!r.ok) return setError(r.error);
      setExpected(r.value.updatedAt);
      setDirty(false);
      setConfirm(null);
      notify(kind === "save" ? `Weekly команды за неделю ${view.weekNumber} сохранён` : `Weekly команды отправлен: ${view.recipients.join(", ")}`);
      router.refresh();
    } catch {
      setError("Нет связи с сервером: отчёт не сохранился");
    } finally {
      setBusy(null);
    }
  };

  const templatePart = template ? (
    <Collapsible id="team-template-block" title="Блоки weekly команды" hint={template.blocks ? template.blocks.map((b) => b.title).join(", ") : "Не заданы: weekly как раньше"} open={!template.blocks} testId="team-template-block">
      <TeamBlocksTemplate initial={template} />
    </Collapsible>
  ) : null;

  // Получатель: только отправленная версия
  if (!view.canEdit && view.sent) {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-body text-muted" data-testid="team-report-sent">
          Отправлен {moment(view.sent.at)}
          {view.sent.by ? `, отправил ${view.sent.by}` : ""}
          {view.sent.editedAfter ? ". После отправки отчёт поправили: здесь отправленная версия" : ""}
        </p>
        <article className="sv-card sv-card--soft px-4 py-4 sm:px-5" data-testid="team-report-view">
          <BlocksView blocks={view.sent.blocks} labels={meta.labels} order={meta.order} idPrefix="team-sent" />
        </article>
      </div>
    );
  }

  if (!view.template) {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-body text-ink">Блоки weekly команды «{view.team.name}» не заданы: weekly команды как раньше. Задайте блоки, и участники будут сдавать weekly по ним, а здесь соберётся отчёт команды.</p>
        {templatePart}
      </div>
    );
  }

  const rebuildTitle = blocks.find((b) => b.key === confirm)?.title ?? "";
  return (
    <div className="flex flex-col gap-5">
      {templatePart}
      {view.sent ? (
        <p className="sv-card sv-card--soft bg-green-soft px-4 py-3 text-body text-ink" data-testid="team-report-sent">
          Отправлен {moment(view.sent.at)}
          {view.sent.by ? `, отправил ${view.sent.by}` : ""}
          {view.sent.to.length ? `. Получил: ${view.sent.to.join(", ")}` : ""}. Можно поправить и отправить ещё раз.
        </p>
      ) : null}
      <p className="max-w-[760px] text-small text-muted">
        Собрано из weekly людей команды, задач и целей команды, цифр и новостей по её продуктам. Каждая строка подписана продуктом. Блок можно поправить, скрыть, поднять или опустить.
      </p>
      <BlocksEditor blocks={blocks} onChange={edit} products={meta.products} labels={meta.labels} order={meta.order} idPrefix="team" onRebuild={(key) => setConfirm(key)} />
      <Collapsible id="team-preview" title="Что получит руководитель" hint={`Weekly команды «${view.team.name}» за неделю ${view.weekNumber}: видимые блоки`} testId="team-preview">
        <BlocksView blocks={withoutEmptyLines(blocks)} labels={meta.labels} order={meta.order} idPrefix="team-preview" />
      </Collapsible>
      {view.sendHint ? <p className="text-body text-muted">{view.sendHint}</p> : null}
      <FormError message={error ?? undefined} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirm("rebuild")}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Собрать заново
        </Button>
        <Button variant="secondary" disabled={busy !== null || !dirty} loading={busy === "save"} onClick={() => void run("save")}>
          <Save className="h-4 w-4" aria-hidden="true" />
          Сохранить
        </Button>
        {view.canSend ? (
          <Button
            disabled={busy !== null}
            onClick={() => (hasBlocksText(withoutEmptyLines(blocks)) ? setConfirm("send") : setError("Weekly команды пустой: в видимых блоках нет ни одной строки"))}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {view.sent ? "Отправить ещё раз" : "Отправить руководителю"}
          </Button>
        ) : null}
      </div>
      <p className="text-caption text-muted">
        Записи сдают в{" "}
        <Link href="/weekly/submit" className="font-medium text-link hover:underline">
          weekly
        </Link>{" "}
        по блокам команды. Отчёт видят руководитель команды, руководители выше и тот, кому его отправили.
      </p>
      <Modal open={confirm === "rebuild"} onOpenChange={(o) => !o && setConfirm(null)} title="Собрать отчёт заново?" description="Все блоки соберутся заново из weekly людей команды, задач, целей и цифр. Ваши правки в блоках пропадут.">
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            Отмена
          </Button>
          <Button
            variant="dark"
            onClick={() => {
              edit(view.auto.map((b) => ({ ...b, lines: [...b.lines] })));
              setConfirm(null);
            }}
          >
            Собрать заново
          </Button>
        </div>
      </Modal>
      <Modal open={!!confirm && confirm !== "rebuild" && confirm !== "send"} onOpenChange={(o) => !o && setConfirm(null)} title={`Собрать блок «${rebuildTitle}» заново?`} description="Строки блока соберутся заново из источников. Ваши правки в этом блоке пропадут, остальные блоки не изменятся.">
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            Отмена
          </Button>
          <Button
            variant="dark"
            onClick={() => {
              if (confirm) edit(rebuildBlock(blocks, view.auto, confirm));
              setConfirm(null);
            }}
          >
            Собрать блок
          </Button>
        </div>
      </Modal>
      <Modal open={confirm === "send"} onOpenChange={(o) => !o && setConfirm(null)} title="Отправить weekly команды?" description={`Получит: ${view.recipients.join(", ")}. Отчёт сохранится и уйдёт в приложении: событие в «Мне» и отчёт по ссылке из него.`}>
        <FormError message={error ?? undefined} />
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            Отмена
          </Button>
          <Button onClick={() => void run("send")} disabled={busy !== null} loading={busy === "send"}>
            {busy === "send" ? "Отправляем…" : "Отправить"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
