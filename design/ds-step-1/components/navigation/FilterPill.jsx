import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { CounterBadge } from '../core/CounterBadge.jsx';

/* Фильтр-пилюля со счётчиком, радиус 32. FilterPills: ряд пилюль, одна или несколько активных. */
export function FilterPill(props) {
  return (
    <button type="button" aria-pressed={props.active} disabled={props.disabled}
      className={['sv-pill', props.active ? 'is-active' : '', props.tone ? 'sv-pill--' + props.tone : '', props.size ? 'sv-pill--' + props.size : '', props.className || ''].filter(Boolean).join(' ')} onClick={props.onClick}>
      {props.icon ? <Icon name={props.icon} size={16} /> : null}
      {props.children}
      {props.count != null ? <CounterBadge value={props.count} tone={props.active ? (props.tone === 'danger' ? 'danger' : 'accent') : 'neutral'} /> : null}
    </button>
  );
}
export function FilterPills(props) {
  var value = props.value || [];
  return (
    <div className={'sv-pills' + (props.scroll ? ' sv-pills--scroll' : '')} role="group" aria-label={props.label} style={props.style}>
      {(props.items || []).map(function (it) {
        var active = value.indexOf(it.value) !== -1;
        return <FilterPill key={it.value} active={active} count={it.count} icon={it.icon} tone={it.tone} disabled={it.disabled} size={props.size}
          onClick={function () { if (!props.onChange) return; props.onChange(active ? value.filter(function (v) { return v !== it.value; }) : (props.multi ? value.concat([it.value]) : [it.value])); }}>{it.label}</FilterPill>;
      })}
    </div>
  );
}
