import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Путь по структуре над заголовком раздела: Департамент, Управление развития продуктов, Продуктовая аналитика. Каждое звено ведёт на свой уровень.
   items: [{ label, level, onClick }], level: департамент, управление, отдел, сектор, команда. */
export function StructurePath(props) {
  var items = props.items || [];
  return (
    <ol className="sv-crumbs sv-crumbs--lg" aria-label="Путь по структуре" style={props.style}>
      {items.map(function (it, i) {
        var last = i === items.length - 1;
        return (
          <li key={i}>
            {i > 0 ? <Icon name="chevron-right" size={16} /> : null}
            {last ? <span className="is-current" aria-current="location">{it.label}</span> : <button type="button" onClick={it.onClick}>{it.label}</button>}
            {it.level && props.showLevels ? <span className="sv-crumbs__level">{it.level}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
