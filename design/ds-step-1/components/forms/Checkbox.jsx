import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Чекбокс: рамка D40 (1,5 px), отмеченный с заливкой акцента и тёмной галочкой. indeterminate для «выбраны не все». */
export function Checkbox(props) {
  var ref = React.useRef(null);
  React.useEffect(function () { if (ref.current) ref.current.indeterminate = !!props.indeterminate; }, [props.indeterminate]);
  return (
    <label className={['sv-check', props.disabled ? 'is-disabled' : '', props.error ? 'is-error' : '', props.className || ''].filter(Boolean).join(' ')} style={props.style}>
      <input ref={ref} type="checkbox" checked={props.checked} defaultChecked={props.defaultChecked} disabled={props.disabled} onChange={props.onChange} aria-label={props.ariaLabel} name={props.name} />
      <span className="sv-check__box"><Icon name="check" size={14} className="sv-icon--check" strokeWidth={2.5} /><Icon name="minus" size={14} className="sv-icon--minus" strokeWidth={2.5} /></span>
      {props.children ? <span className="sv-check__text"><span>{props.children}</span>{props.sub ? <span className="sv-check__sub">{props.sub}</span> : null}</span> : null}
    </label>
  );
}
export function Radio(props) {
  return (
    <label className={['sv-check', props.disabled ? 'is-disabled' : '', props.className || ''].filter(Boolean).join(' ')}>
      <input type="radio" name={props.name} value={props.value} checked={props.checked} defaultChecked={props.defaultChecked} disabled={props.disabled} onChange={props.onChange} />
      <span className="sv-check__box sv-check__box--radio" />
      {props.children ? <span className="sv-check__text"><span>{props.children}</span>{props.sub ? <span className="sv-check__sub">{props.sub}</span> : null}</span> : null}
    </label>
  );
}
