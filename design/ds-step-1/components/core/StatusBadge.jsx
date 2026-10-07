import React from 'react';

/* Метка статуса: слово всегда рядом с цветом.
   tone: success, warning, danger, info, accent, neutral, outline (Предложена), brand. dot: точка; half: половинная точка (Частично). */
export var TASK_STATUS = {
  done: { label: 'Выполнена', tone: 'success', dot: true },
  progress: { label: 'В работе', tone: 'accent', dot: true },
  clarify: { label: 'Требует уточнений', tone: 'warning', dot: true },
  failed: { label: 'Не выполнена', tone: 'danger', dot: true },
  partial: { label: 'Частично', tone: 'success', dot: true, half: true },
  cancelled: { label: 'Отменена', tone: 'neutral', dot: true },
  proposed: { label: 'Предложена', tone: 'outline' }
};
export var WEEKLY_STATUS = {
  submitted: { label: 'Сдан', tone: 'success', dot: true },
  draft: { label: 'Черновик', tone: 'accent', dot: true },
  none: { label: 'Не начат', tone: 'neutral', dot: true },
  late: { label: 'Сдан с опозданием', tone: 'warning', dot: true },
  vacation: { label: 'В отпуске', tone: 'neutral' }
};
export var REQUEST_STATUS = {
  waiting: { label: 'Ждёт ответа', tone: 'info', dot: true },
  accepted: { label: 'Принята', tone: 'accent', dot: true },
  done: { label: 'Выполнена', tone: 'success', dot: true },
  declined: { label: 'Отклонена', tone: 'neutral', dot: true },
  overdue: { label: 'Просрочена', tone: 'danger', dot: true }
};
export function StatusBadge(props) {
  var preset = props.task ? TASK_STATUS[props.task] : props.weekly ? WEEKLY_STATUS[props.weekly] : props.request ? REQUEST_STATUS[props.request] : null;
  var tone = props.tone || (preset && preset.tone) || 'neutral';
  var dot = props.dot != null ? props.dot : (preset ? !!preset.dot : false);
  var half = props.half != null ? props.half : (preset ? !!preset.half : false);
  var label = props.children || (preset && preset.label) || '';
  var cls = ['sv-badge', 'sv-badge--' + tone, props.size === 'lg' ? 'sv-badge--lg' : '', props.className || ''].filter(Boolean).join(' ');
  return (
    <span className={cls} title={props.title}>
      {dot ? <span className={'sv-badge__dot' + (half ? ' sv-badge__dot--half' : '')} /> : null}
      {label}{props.suffix ? <span style={{ fontWeight: 400 }}>{props.suffix}</span> : null}
    </span>
  );
}
