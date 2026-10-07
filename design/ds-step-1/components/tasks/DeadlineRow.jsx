import React from 'react';
import { OverdueLabel } from '../core/OverdueLabel.jsx';

/* Строка раздела «Сроки» в «Мне»: номер, название, справа «просрочена на N дн.» или дата срока. rows: [{ num, title, overdueDays, due }]. */
export function DeadlineRow(props) {
  return (
    <a className="sv-deadline" href={props.href || '#'} onClick={props.onClick} style={props.style}>
      <span className="sv-deadline__num">{props.num}</span>
      <span className="sv-deadline__title">{props.title}</span>
      {props.overdueDays ? <OverdueLabel days={props.overdueDays} /> : props.due ? <span className="sv-deadline__num">{props.due}</span> : null}
    </a>
  );
}
export function DeadlineList(props) {
  return <div className="sv-deadline-list" role="list" style={props.style}>{(props.rows || []).map(function (r) { return <DeadlineRow key={r.num} {...r} onClick={props.onPick ? function (e) { e.preventDefault(); props.onPick(r); } : undefined} />; })}</div>;
}
