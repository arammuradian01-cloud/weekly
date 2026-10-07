import React from 'react';

/* Обёртка поля: подпись, подсказка или ошибка, счётчик знаков. Ошибка говорит, что случилось и что делать. */
export function FormField(props) {
  var over = props.max != null && props.count > props.max;
  var hintText = props.error || props.hint;
  return (
    <div className={['sv-field', props.disabled ? 'is-disabled' : '', props.className || ''].filter(Boolean).join(' ')} style={props.style}>
      {props.label ? <label className="sv-field__label" htmlFor={props.htmlFor}>{props.label}{props.optional ? <span className="sv-field__optional">не обязательно</span> : null}</label> : null}
      {props.children}
      {hintText || props.max != null ? (
        <div className={'sv-field__hint' + (props.error ? ' sv-field__hint--error' : '')}>
          <span>{hintText}</span>
          {props.max != null ? <span className={'sv-field__count' + (over ? ' sv-field__count--over' : '')} aria-live="polite">{(props.count || 0) + ' из ' + props.max}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
