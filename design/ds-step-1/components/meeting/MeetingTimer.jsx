import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Таймер лидера, по умолчанию 7 минут. seconds: осталось. total: всего. Состояния: идёт, осталась минута (предупреждение), время вышло (ошибка, без звука), paused.
   size: lg для проектора. */
export function fmt(s) {
  var neg = s < 0; s = Math.abs(s);
  var m = Math.floor(s / 60), sec = s % 60;
  return (neg ? '+' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
}
export function MeetingTimer(props) {
  var total = props.total || 420;
  var left = props.seconds != null ? props.seconds : total;
  var tone = left <= 0 ? 'danger' : left <= 60 ? 'warning' : '';
  var cls = ['sv-timer', tone ? 'sv-timer--' + tone : '', props.paused ? 'sv-timer--paused' : '', props.size === 'lg' ? 'sv-timer--lg' : ''].filter(Boolean).join(' ');
  var label = left <= 0 ? 'время вышло' : props.paused ? 'пауза' : (props.label || 'лидер');
  return (
    <div className={cls} role="timer" aria-live={left <= 60 ? 'polite' : 'off'} aria-label={'Таймер: ' + fmt(left)} style={props.style}>
      <Icon name={left <= 0 ? 'alarm-clock-off' : props.paused ? 'pause' : 'timer'} size={props.size === 'lg' ? 24 : 18} />
      <span>{fmt(left)}</span>
      <span className="sv-timer__bar" aria-hidden="true"><span className="sv-timer__fill" style={{ width: Math.max(0, Math.min(100, left / total * 100)) + '%' }} /></span>
      <span className="sv-timer__label">{label}</span>
    </div>
  );
}
