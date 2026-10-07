import React from 'react';
import { IconButton } from '../core/IconButton.jsx';
import { StatusBadge } from '../core/StatusBadge.jsx';

/* Переключатель недели: стрелки, номер и даты, «Текущая», метка состояния недели (закрыта). */
export function WeekSwitcher(props) {
  var n = props.number || 41;
  var dates = props.dates || '05.10-11.10';
  return (
    <div className="sv-week" role="group" aria-label="Неделя" style={props.style}>
      <IconButton icon="chevron-left" label="Прошлая неделя" size="sm" onClick={props.onPrev} />
      <button type="button" className="sv-week__label" onClick={props.onPick} aria-haspopup="dialog">
        <span>Неделя {n}</span><span className="sv-week__dates">{dates}</span>
      </button>
      {props.closed ? <StatusBadge tone="neutral">Закрыта</StatusBadge> : null}
      {props.isCurrent === false ? <button type="button" className="sv-week__now" onClick={props.onToday}>Текущая</button> : null}
      <IconButton icon="chevron-right" label="Следующая неделя" size="sm" onClick={props.onNext} disabled={props.isCurrent !== false && !props.allowFuture} />
    </div>
  );
}
