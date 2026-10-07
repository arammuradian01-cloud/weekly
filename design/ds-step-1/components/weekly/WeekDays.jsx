import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Полоса из семи дней недели и две ячейки: срок weekly и встреча. days: [{ wd, n, today, past, weekend, mark: { kind: 'deadline' | 'meeting', label } }].
   По умолчанию неделя 41, 05.10-11.10.2026, сегодня среда 07.10. */
var DEFAULT = [
  { wd: 'пн', n: 5, past: true }, { wd: 'вт', n: 6, past: true }, { wd: 'ср', n: 7, today: true }, { wd: 'чт', n: 8 }, { wd: 'пт', n: 9 }, { wd: 'сб', n: 10, weekend: true }, { wd: 'вс', n: 11, weekend: true }
];
export function WeekDays(props) {
  var days = props.days || DEFAULT;
  return (
    <div style={props.style}>
      <div className="sv-days" role="list" aria-label="Дни недели">
        {days.map(function (d) {
          return (
            <div key={d.wd} role="listitem" className={['sv-day', d.today ? 'is-today' : '', d.past ? 'is-past' : '', d.weekend ? 'is-weekend' : ''].filter(Boolean).join(' ')} aria-current={d.today ? 'date' : undefined}>
              <span className="sv-day__wd">{d.wd}</span><span className="sv-day__n">{d.n}</span>
              {d.mark ? <span className={'sv-day__mark sv-day__mark--' + d.mark.kind}>{d.mark.label}</span> : null}
            </div>
          );
        })}
      </div>
      {props.events !== null ? (
        <div className="sv-days-events">
          <div className="sv-days-event"><Icon name="send" size={16} className="sv-icon--secondary" /><span><b>пн 12.10, 18:00</b>: срок weekly</span></div>
          <div className="sv-days-event"><Icon name="presentation" size={16} className="sv-icon--secondary" /><span><b>вт 13.10, 11:00</b>: встреча</span></div>
        </div>
      ) : null}
    </div>
  );
}
