import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Поле ввода с заливкой, как на сайте. size: sm 36, md 44, lg 52. icon слева, affix справа, action: кнопка внутри поля ({ label, onClick }). */
export function Input(props) {
  var size = props.size || 'md';
  var cls = ['sv-input', size !== 'md' ? 'sv-input--' + size : '', props.error ? 'is-error' : '', props.disabled ? 'is-disabled' : '', props.readOnly ? 'is-readonly' : '',
    props.focused ? 'is-focused' : '', props.loading ? 'is-loading' : '', props.className || ''].filter(Boolean).join(' ');
  return (
    <div className={cls} style={props.style}>
      {props.icon ? <Icon name={props.icon} size={18} /> : null}
      <input className="sv-input__control" id={props.id} type={props.type || 'text'} value={props.value} defaultValue={props.defaultValue} placeholder={props.placeholder}
        disabled={props.disabled} readOnly={props.readOnly} onChange={props.onChange} onKeyDown={props.onKeyDown} aria-invalid={props.error || undefined} aria-describedby={props.describedBy}
        autoComplete={props.autoComplete} inputMode={props.inputMode} name={props.name} />
      {props.loading ? <span className="sv-spinner" /> : null}
      {props.affix ? <span className="sv-input__affix">{props.affix}</span> : null}
      {props.action ? <button type="button" className="sv-input__btn" onClick={props.action.onClick} aria-pressed={props.action.pressed}>{props.action.label}</button> : null}
      {props.iconRight ? <Icon name={props.iconRight} size={18} /> : null}
    </div>
  );
}
