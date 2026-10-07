import React from 'react';

/* Полоса истории статусов в карточке задачи: сколько дней задача была в каждом статусе. segments: [{ status, days }]. */
var LABEL = { proposed: 'Предложена', progress: 'В работе', clarify: 'Требует уточнений', done: 'Выполнена', failed: 'Не выполнена', cancelled: 'Отменена' };
var COLOR = { proposed: 'var(--color-info-dot)', progress: 'var(--color-accent)', clarify: 'var(--color-warning-dot)', done: 'var(--color-success-dot)', failed: 'var(--color-danger-dot)', cancelled: 'var(--color-neutral-dot)' };
export function StatusHistoryBar(props) {
  var segs = props.segments || [];
  var total = segs.reduce(function (s, x) { return s + x.days; }, 0) || 1;
  return (
    <div className="sv-status-history" style={props.style}>
      <div className="sv-status-history__bar" role="img" aria-label={segs.map(function (s) { return LABEL[s.status] + ': ' + s.days + ' дн.'; }).join(', ')}>
        {segs.map(function (s, i) { return <span key={i} className={'sv-status-history__seg sv-status-history__seg--' + s.status} style={{ flex: s.days / total }} title={LABEL[s.status] + ': ' + s.days + ' дн.'} />; })}
      </div>
      <div className="sv-status-history__legend">
        {segs.map(function (s, i) { return <span key={i}><i style={{ background: COLOR[s.status] }} />{LABEL[s.status]} <b>{s.days} дн.</b></span>; })}
        <span style={{ marginLeft: 'auto' }}>всего <b>{total} дн.</b></span>
      </div>
    </div>
  );
}
