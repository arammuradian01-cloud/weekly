import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Переключатель. labelRight: подпись слева, тумблер справа (список настроек писем). locked: заблокирован при общем логине, с замком и пояснением. */
export function Switch(props) {
  var disabled = props.disabled || props.locked;
  return (
    <label className={['sv-switch', props.labelRight ? 'sv-switch--right' : '', disabled ? 'is-disabled' : '', props.className || ''].filter(Boolean).join(' ')} style={props.style}>
      <input type="checkbox" role="switch" checked={props.checked} defaultChecked={props.defaultChecked} disabled={disabled} onChange={props.onChange} aria-label={props.ariaLabel} />
      <span className="sv-switch__track" />
      {props.children ? <span className="sv-switch__text"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{props.children}{props.locked ? <Icon name="lock" size={14} className="sv-switch__lock" /> : null}</span>{props.sub ? <span className="sv-switch__sub">{props.sub}</span> : null}</span> : null}
    </label>
  );
}
