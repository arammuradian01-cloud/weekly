import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Kbd } from '../core/Kbd.jsx';

/* Меню действий. items: [{ key, label, icon, hotkey, danger, disabled, sep: true, group }]. staticMenu: без позиционирования. */
export function Menu(props) {
  return (
    <div className={'sv-menu' + (props.staticMenu ? ' sv-menu--static' : '')} role="menu" aria-label={props.label} style={Object.assign({ minWidth: 220 }, props.style)}>
      {(props.items || []).map(function (it, i) {
        if (it.sep) return <div key={'s' + i} className="sv-menu__sep" />;
        if (it.group) return <div key={'g' + i} className="sv-menu__group">{it.group}</div>;
        return (
          <button type="button" key={it.key} role="menuitem" disabled={it.disabled} className={['sv-menu__item', it.danger ? 'is-danger' : '', it.active ? 'is-active' : ''].filter(Boolean).join(' ')} onClick={function () { props.onPick && props.onPick(it.key); }}>
            {it.icon ? <Icon name={it.icon} size={18} /> : null}
            <span className="sv-menu__item__body"><span>{it.label}</span>{it.sub ? <span className="sv-menu__item__sub">{it.sub}</span> : null}</span>
            {it.hotkey ? <Kbd className="sv-menu__kbd">{it.hotkey}</Kbd> : null}
          </button>
        );
      })}
    </div>
  );
}
