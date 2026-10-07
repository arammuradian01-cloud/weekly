import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';

/* Тост: «Сохранено», «Задача создана», «Не сохранилось» с «Повторить», «Удалено» с «Отменить» на 5 секунд. Несколько стопкой (ToastStack).
   toast: { id, tone: success | error | info | neutral, text, action: { label, onClick }, progress: 0..100 }. */
export function Toast(props) {
  var t = props.toast || props;
  var icon = t.tone === 'success' ? 'check-circle-2' : t.tone === 'error' ? 'alert-circle' : t.tone === 'info' ? 'info' : 'trash-2';
  return (
    <div className={'sv-toast' + (t.tone ? ' sv-toast--' + t.tone : '')} role={t.tone === 'error' ? 'alert' : 'status'} style={props.style}>
      <span className="sv-toast__icon"><Icon name={icon} size={20} /></span>
      <span className="sv-toast__text">{t.text}</span>
      {t.action ? <button type="button" className="sv-toast__action" onClick={t.action.onClick}>{t.action.label}</button> : null}
      <IconButton icon="x" label="Закрыть" size="xs" className="sv-toast__close" onClick={props.onClose} />
      {t.progress != null ? <span className="sv-toast__timer" style={{ width: t.progress + '%' }} aria-hidden="true" /> : null}
    </div>
  );
}
export function ToastStack(props) {
  return <div className={'sv-toasts' + (props.staticStack ? ' sv-toasts--static' : '')} aria-live="polite" style={props.style}>{(props.toasts || []).map(function (t) { return <Toast key={t.id} toast={t} onClose={function () { props.onClose && props.onClose(t.id); }} />; })}</div>;
}
