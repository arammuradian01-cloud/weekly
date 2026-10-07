import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Input } from './Input.jsx';

/* Выпадающий список. options: [{ value, label, sub, icon, disabled }]. searchable: поле поиска внутри (выбор с поиском).
   open: принудительно открыт (для макетов). Выбор стрелками и Enter. */
export function Select(props) {
  var st = React.useState(!!props.open);
  var open = st[0], setOpen = st[1];
  var qs = React.useState('');
  var q = qs[0], setQ = qs[1];
  var as = React.useState(0);
  var active = as[0], setActive = as[1];
  var options = props.options || [];
  var filtered = q ? options.filter(function (o) { return (o.label + ' ' + (o.sub || '')).toLowerCase().indexOf(q.toLowerCase()) !== -1; }) : options;
  var selected = options.filter(function (o) { return o.value === props.value; })[0];
  var size = props.size || 'md';
  function pick(o) { if (o.disabled) return; props.onChange && props.onChange(o.value); setOpen(false); setQ(''); }
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(Math.min(active + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && filtered[active]) pick(filtered[active]); else setOpen(true); }
    else if (e.key === 'Escape') { setOpen(false); }
  }
  return (
    <div className="sv-select" style={props.style}>
      <button type="button" id={props.id} className={['sv-input', 'sv-select__trigger', size !== 'md' ? 'sv-input--' + size : '', open ? 'is-focused' : '', props.error ? 'is-error' : '', props.disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}
        aria-haspopup="listbox" aria-expanded={open} disabled={props.disabled} onClick={function () { setOpen(!open); }} onKeyDown={onKey}>
        {props.icon ? <Icon name={props.icon} size={18} /> : null}
        {selected && selected.icon ? <Icon name={selected.icon} size={18} /> : null}
        <span className={'sv-select__value' + (selected ? '' : ' sv-select__value--placeholder')}>{selected ? selected.label : (props.placeholder || 'Выберите')}</span>
        <Icon name="chevron-down" size={18} />
      </button>
      {open ? (
        <div className={'sv-menu' + (props.staticMenu ? ' sv-menu--static' : '')} role="listbox">
          {props.searchable ? <div className="sv-menu__search"><Input size="sm" icon="search" placeholder={props.searchPlaceholder || 'Найти'} value={q} onChange={function (e) { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} /></div> : null}
          {filtered.length === 0 ? <div className="sv-menu__empty">{props.emptyText || 'Ничего не нашлось'}</div> : null}
          {filtered.map(function (o, i) {
            var isSel = o.value === props.value;
            return (
              <button type="button" key={o.value} role="option" aria-selected={isSel} disabled={o.disabled}
                className={['sv-menu__item', isSel ? 'is-selected' : '', i === active ? 'is-active' : ''].filter(Boolean).join(' ')} onClick={function () { pick(o); }} onMouseEnter={function () { setActive(i); }}>
                {o.icon ? <Icon name={o.icon} size={18} /> : null}
                {o.avatar ? o.avatar : null}
                <span className="sv-menu__item__body"><span>{o.label}</span>{o.sub ? <span className="sv-menu__item__sub">{o.sub}</span> : null}</span>
                {isSel ? <Icon name="check" size={18} className="sv-menu__item__check" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
