import React from 'react';
import { IconButton } from '../core/IconButton.jsx';
import { Icon } from '../core/Icon.jsx';

/* Шторка снизу на телефоне: быстрые действия с карточкой, ответ на просьбу за два нажатия, обновление задачи.
   inline: без затемнения. SheetRow: строка действия не ниже 44. */
export function BottomSheet(props) {
  var sheet = (
    <div className={'sv-sheet' + (props.className ? ' ' + props.className : '')} role="dialog" aria-modal="true" aria-label={props.title} style={props.style}>
      <div className="sv-sheet__grip" aria-hidden="true" />
      {props.title ? <header className="sv-sheet__head"><h3 className="sv-sheet__title">{props.title}</h3>{props.onClose ? <IconButton icon="x" label="Закрыть" size="sm" onClick={props.onClose} /> : null}</header> : null}
      <div className="sv-sheet__body">{props.children}</div>
    </div>
  );
  if (props.inline) return sheet;
  return <div className={'sv-overlay sv-overlay--bottom' + (props.fixed ? ' sv-overlay--fixed' : '')} onClick={function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); }}>{sheet}</div>;
}
export function SheetRow(props) {
  return (
    <button type="button" className={'sv-sheet__row' + (props.danger ? ' sv-sheet__row--danger' : '')} onClick={props.onClick} disabled={props.disabled}>
      {props.icon ? <Icon name={props.icon} size={22} /> : null}<span style={{ flex: 1 }}>{props.children}</span>{props.trailing}
    </button>
  );
}
