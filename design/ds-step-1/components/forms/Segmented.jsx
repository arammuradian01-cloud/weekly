import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { CounterBadge } from '../core/CounterBadge.jsx';

/* Сегментный переключатель, как на главной сайта: «По людям / По блокам», «Таблица / По статусам / По людям», «Задача / Просьба».
   items: [{ value, label, icon, count, disabled }]. */
export function Segmented(props) {
  return (
    <div className={['sv-segment', props.block ? 'sv-segment--block' : '', props.size === 'lg' ? 'sv-segment--lg' : '', props.className || ''].filter(Boolean).join(' ')} role="tablist" aria-label={props.label} style={props.style}>
      {(props.items || []).map(function (it) {
        var active = it.value === props.value;
        return (
          <button type="button" key={it.value} role="tab" aria-selected={active} disabled={it.disabled} className={'sv-segment__item' + (active ? ' is-active' : '')}
            onClick={function () { props.onChange && props.onChange(it.value); }}>
            {it.icon ? <Icon name={it.icon} size={18} /> : null}{it.label}
            {it.count != null ? <CounterBadge value={it.count} tone="neutral" /> : null}
          </button>
        );
      })}
    </div>
  );
}
