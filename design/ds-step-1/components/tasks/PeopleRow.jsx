import React from 'react';
import { Avatar } from '../core/Avatar.jsx';

/* Строка вида «По людям»: сотрудник и его задачи плашками по сроку, чтобы видеть перегруз и простой.
   tasks: [{ id, title, kind: 'overdue' | 'soon' | 'done' | 'normal' }]. */
export function PeopleRow(props) {
  var tasks = props.tasks || [];
  return (
    <div className="sv-people-row" style={props.style}>
      <div className="sv-people-row__person">
        <Avatar name={props.name} size="md" status={props.weekly} />
        <div style={{ minWidth: 0 }}><div className="sv-people-row__name">{props.name}</div><div className="sv-people-row__sub">{props.sub || (tasks.length + ' задач')}</div></div>
      </div>
      <div className="sv-people-row__chips">
        {tasks.length === 0 ? <span className="sv-people-row__empty">Открытых задач нет</span> : null}
        {tasks.map(function (t) { return <button type="button" key={t.id} className={'sv-chip-task' + (t.kind && t.kind !== 'normal' ? ' sv-chip-task--' + t.kind : '')} title={t.title} onClick={function () { props.onOpen && props.onOpen(t); }}>№{t.id}<span>{t.title}</span></button>; })}
      </div>
    </div>
  );
}
