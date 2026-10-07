import React from 'react';
import { Avatar } from '../core/Avatar.jsx';
import { Icon } from '../core/Icon.jsx';
import { StatusBadge } from '../core/StatusBadge.jsx';

/* Строка человека в команде: аватар, должность, статус weekly, открытые задачи, просрочка, переносы срока за месяц, просьбы к человеку. Открывает профиль.
   person: { name, role, weekly, open, overdue, moved, requests, vacationUntil, substitute }. */
function Num(props) {
  return <span className={['sv-team-row__stat', props.value === 0 ? 'is-zero' : '', props.bad && props.value > 0 ? 'is-bad' : '', props.warn && props.value > 0 ? 'is-warn' : ''].filter(Boolean).join(' ')}><b>{props.value}</b><small>{props.label}</small></span>;
}
export function PersonRow(props) {
  var p = props.person || {};
  return (
    <div className="sv-person-row" role="button" tabIndex={0} onClick={props.onOpen} style={props.style}>
      <Avatar name={p.name} size="lg" vacancy={p.vacancy} />
      <div style={{ minWidth: 0 }}>
        <div className="sv-person-row__name">{p.vacancy ? 'Вакансия' : p.name}{p.weekly ? <StatusBadge weekly={p.weekly} suffix={p.weekly === 'vacation' && p.substitute ? ', замещает ' + p.substitute : null} /> : null}</div>
        <div className="sv-person-row__role">{p.role}{p.vacationUntil ? ', в отпуске до ' + p.vacationUntil : ''}</div>
      </div>
      <Num value={p.open || 0} label="открытых" />
      <Num value={p.overdue || 0} label="просрочено" bad />
      <Num value={p.moved || 0} label="переносов" warn />
      <Num value={p.requests || 0} label="просьб" />
      <Icon name="chevron-right" size={18} className="sv-icon--muted" />
    </div>
  );
}
