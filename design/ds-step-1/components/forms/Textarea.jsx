import React from 'react';

/* Многострочное поле. Счётчик знаков идёт через FormField (max, count): «Что произошло» до 150, «Подробнее» до 1000. */
export function Textarea(props) {
  var cls = ['sv-input', 'sv-textarea', props.error ? 'is-error' : '', props.disabled ? 'is-disabled' : '', props.focused ? 'is-focused' : '', props.className || ''].filter(Boolean).join(' ');
  return (
    <div className={cls} style={props.style}>
      <textarea className="sv-input__control" id={props.id} rows={props.rows || 3} value={props.value} defaultValue={props.defaultValue} placeholder={props.placeholder}
        disabled={props.disabled} onChange={props.onChange} aria-invalid={props.error || undefined} maxLength={props.hardMax} />
    </div>
  );
}
