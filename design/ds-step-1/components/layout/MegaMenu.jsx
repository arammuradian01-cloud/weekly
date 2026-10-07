import React from 'react';
import { IconCircle } from '../core/Icon.jsx';
import { CounterBadge } from '../core/CounterBadge.jsx';

/* Выпадающее меню как на сайте: иконки на тонированных кругах в две колонки, подпись в одну строку, снизу строка простых ссылок.
   items: [{ key, label, sub, icon, tone, active, count }], links: [{ label, href }]. staticMenu: без позиционирования. */
export function MegaMenu(props) {
  return (
    <div className={'sv-mega' + (props.staticMenu ? ' sv-mega--static' : '')} role="menu" aria-label={props.title} style={props.style}>
      {props.title ? <h3 className="sv-mega__head">{props.title}</h3> : null}
      <div className="sv-mega__grid">
        {(props.items || []).map(function (it) {
          return (
            <a key={it.key} href={it.href || '#' + it.key} role="menuitem" className={'sv-mega__item' + (it.active ? ' is-active' : '')} onClick={function (e) { if (props.onPick) { e.preventDefault(); props.onPick(it.key); } }}>
              <IconCircle name={it.icon || 'circle'} tone={it.tone || (it.active ? 'accent' : 'neutral')} size={40} iconSize={20} />
              <span className="sv-mega__item__body"><span>{it.label}</span>{it.sub ? <span className="sv-mega__item__sub">{it.sub}</span> : null}</span>
              {it.count ? <CounterBadge value={it.count} /> : null}
            </a>
          );
        })}
      </div>
      {props.links && props.links.length ? <div className="sv-mega__links">{props.links.map(function (l) { return <a key={l.label} href={l.href || '#'} onClick={l.onClick}>{l.label}</a>; })}</div> : null}
    </div>
  );
}
