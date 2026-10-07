import React from 'react';

/* Светофор из трёх точек: weekly сдан, есть просрочки, цели в риске. Значения: ok, warn, bad, off. labels: со словами. */
var WORDS = { weekly: { ok: 'weekly сдан', warn: 'weekly частично', bad: 'weekly не сдан', off: 'weekly: нет данных' }, overdue: { ok: 'без просрочек', warn: 'есть просрочки', bad: 'много просрочек', off: 'просрочки: нет данных' }, goals: { ok: 'цели в графике', warn: 'цели в риске', bad: 'цели не достигаются', off: 'целей нет' } };
export function TrafficLights(props) {
  var v = { weekly: props.weekly || 'off', overdue: props.overdue || 'off', goals: props.goals || 'off' };
  var label = Object.keys(v).map(function (k) { return WORDS[k][v[k]]; }).join(', ');
  if (props.labels) {
    return <span className="sv-lights sv-lights--labels" style={props.style}>{Object.keys(v).map(function (k) { return <span key={k}><i className={'sv-lights__dot sv-lights__dot--' + v[k]} />{WORDS[k][v[k]]}</span>; })}</span>;
  }
  return <span className="sv-lights" role="img" aria-label={label} title={label} style={props.style}>{Object.keys(v).map(function (k) { return <i key={k} className={'sv-lights__dot sv-lights__dot--' + v[k]} />; })}</span>;
}
