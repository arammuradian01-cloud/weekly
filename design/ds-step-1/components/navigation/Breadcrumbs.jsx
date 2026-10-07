import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Хлебные крошки в карточке: Задачи, КАСКО, №124. items: [{ label, href, onClick }], последняя текущая. */
export function Breadcrumbs(props) {
  var items = props.items || [];
  return (
    <ol className={'sv-crumbs' + (props.size === 'lg' ? ' sv-crumbs--lg' : '')} aria-label={props.label || 'Путь'} style={props.style}>
      {items.map(function (it, i) {
        var last = i === items.length - 1;
        return (
          <li key={i}>
            {i > 0 ? <Icon name="chevron-right" size={14} /> : null}
            {last ? <span className="is-current" aria-current="page">{it.label}</span> : <a href={it.href || '#'} onClick={it.onClick}>{it.label}</a>}
          </li>
        );
      })}
    </ol>
  );
}
