import React from 'react';

/* Сводка подразделения в панели: люди, задачи, просрочка, цели. cells: [{ label, value, tone }]. */
export function UnitSummary(props) {
  return <div className="sv-unit-summary" style={props.style}>{(props.cells || []).map(function (c, i) { return <div key={i} className={'sv-unit-summary__cell' + (c.tone ? ' is-' + c.tone : '')}><b>{c.value}</b><small>{c.label}</small></div>; })}</div>;
}
