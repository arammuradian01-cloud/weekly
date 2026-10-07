import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Пометка «Сохранено в 14:32». state: saved, saving, offline (черновик на устройстве), error. Deadline: время до срока. */
export function SavedMark(props) {
  var state = props.state || 'saved';
  var icon = state === 'saved' ? 'check' : state === 'saving' ? 'loader' : state === 'offline' ? 'wifi-off' : 'alert-circle';
  var text = state === 'saved' ? 'Сохранено' : state === 'saving' ? 'Сохраняем' : state === 'offline' ? 'Нет сети, черновик на устройстве' : 'Не сохранилось';
  return (
    <span className={'sv-saved sv-saved--' + state} role="status" style={props.style}>
      <Icon name={icon} size={14} />{text}{props.time && state === 'saved' ? <span className="sv-saved__time">в {props.time}</span> : null}
      {state === 'error' && props.onRetry ? <button type="button" className="sv-btn sv-btn--text sv-btn--sm" style={{ height: 24, padding: '0 6px' }} onClick={props.onRetry}>Повторить</button> : null}
    </span>
  );
}
export function Deadline(props) {
  var tone = props.late ? ' sv-deadline--late' : props.soon ? ' sv-deadline--soon' : '';
  return <span className={'sv-deadline' + tone} style={props.style}><Icon name="clock" size={14} />{props.late ? 'Срок прошёл ' + props.late : 'До срока ' + props.left}</span>;
}
