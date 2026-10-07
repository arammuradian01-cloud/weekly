import React from 'react';
import { Avatar } from '../core/Avatar.jsx';
import { Icon } from '../core/Icon.jsx';
import { TrafficLights } from './TrafficLights.jsx';

/* Строка команды в «Моих командах»: руководитель, «weekly сдали N из M», задач в работе, просрочено, требует уточнений, давно не обновлялись, целей в риске.
   team: { name, lead, mine, weeklyDone, weeklyTotal, inWork, overdue, clarify, stale, goalsRisk, lights }. TeamList: обёртка с шапкой. */
function Stat(props) {
  var cls = ['sv-team-row__stat', props.value === 0 ? 'is-zero' : '', props.bad && props.value > 0 ? 'is-bad' : '', props.warn && props.value > 0 ? 'is-warn' : ''].filter(Boolean).join(' ');
  return <span className={cls}><b>{props.text || props.value}</b><small>{props.label}</small></span>;
}
export function TeamRow(props) {
  var t = props.team || {};
  return (
    <div className={'sv-team-row' + (t.mine ? ' is-mine' : '')} role="button" tabIndex={0} onClick={props.onOpen} style={props.style}>
      <div className="sv-team-row__main">
        <span className="sv-team-row__name">{t.name}{t.lights ? <TrafficLights {...t.lights} /> : null}</span>
        <span className="sv-team-row__lead"><Avatar name={t.lead} size="xs" />{t.lead}{t.mine ? ', ваша команда' : ''}</span>
      </div>
      <Stat text={t.weeklyDone + ' из ' + t.weeklyTotal} value={t.weeklyDone} label="weekly сдали" warn={t.weeklyDone < t.weeklyTotal} />
      <Stat value={t.inWork} label="в работе" />
      <Stat value={t.overdue} label="просрочено" bad />
      <Stat value={t.clarify} label="уточнений" warn />
      <Stat value={t.stale} label="не обновлялись" warn />
      <Icon name="chevron-right" size={18} className="sv-icon--muted" />
    </div>
  );
}
export function TeamList(props) {
  return (
    <div className="sv-team-list" style={props.style}>
      {props.noHead ? null : <div className="sv-team-list__head"><span>Команда</span><span>Weekly</span><span>В работе</span><span>Просрочено</span><span>Уточнений</span><span>Не обновлялись</span><span /></div>}
      {props.children}
    </div>
  );
}
