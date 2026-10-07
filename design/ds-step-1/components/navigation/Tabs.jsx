import React from 'react';
import { CounterBadge } from '../core/CounterBadge.jsx';

/* Текстовые вкладки с голубым подчёркиванием, как на ОСАГО. items: [{ value, label, count, disabled }]. */
export function Tabs(props) {
  return (
    <div className={['sv-tabs', props.plain ? 'sv-tabs--plain' : '', props.size === 'lg' ? 'sv-tabs--lg' : '', props.className || ''].filter(Boolean).join(' ')} role="tablist" style={props.style}>
      {(props.items || []).map(function (it) {
        var active = it.value === props.value;
        return (
          <button type="button" key={it.value} role="tab" aria-selected={active} disabled={it.disabled} className={'sv-tabs__item' + (active ? ' is-active' : '')} onClick={function () { props.onChange && props.onChange(it.value); }}>
            {it.label}{it.count != null ? <CounterBadge value={it.count} tone={active ? 'accent' : 'neutral'} /> : null}
          </button>
        );
      })}
    </div>
  );
}
