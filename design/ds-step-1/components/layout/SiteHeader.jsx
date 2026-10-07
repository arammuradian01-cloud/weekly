import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Kbd } from '../core/Kbd.jsx';
import { Logo } from '../core/Logo.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { Button } from '../core/Button.jsx';
import { CounterBadge } from '../core/CounterBadge.jsx';
import { SIDEBAR_ITEMS } from '../navigation/Sidebar.jsx';
import { TeamSwitcher } from '../navigation/TeamSwitcher.jsx';
import { WeekSwitcher } from '../navigation/WeekSwitcher.jsx';
import { MegaMenu } from './MegaMenu.jsx';

/* Светлая шапка как на сайте Сравни: логотип, название продукта, разделы в строку, «Ещё» с выпадающим меню управления, справа команда, неделя, поиск, «Новая задача», профиль.
   items: как у Sidebar; разделы с group уходят в «Ещё». moreOpen: открыть «Ещё» для макета. */
export function SiteHeader(props) {
  var items = props.items || SIDEBAR_ITEMS;
  var counts = props.counts || {};
  var isManager = props.isManager !== false;
  var isAdmin = props.isAdmin !== false;
  var st = React.useState(!!props.moreOpen);
  var open = st[0], setOpen = st[1];
  var main = items.filter(function (it) { return !it.group && (!it.managerOnly || isManager); });
  var more = items.filter(function (it) { return it.group && isAdmin; });
  var moreActive = more.some(function (it) { return it.key === props.active; });
  return (
    <header className="sv-site-header" style={props.style}>
      <a className="sv-sidebar__skip" href="#content">Перейти к содержимому</a>
      <div className="sv-site-header__row">
        <a className="sv-site-header__brand" href="#week" aria-label="Weekly, на главную"><Logo height={24} /><span className="sv-site-header__product">Weekly</span></a>
        <nav className="sv-site-header__nav" aria-label="Разделы" style={{ overflow: open ? 'visible' : undefined }}>
          {main.map(function (it) {
            var active = it.key === props.active;
            return <a key={it.key} href={'#' + it.key} className={'sv-site-header__link' + (active ? ' is-active' : '')} aria-current={active ? 'page' : undefined} onClick={function (e) { if (props.onSelect) { e.preventDefault(); props.onSelect(it.key); } }}>{it.label}{counts[it.key] ? <CounterBadge value={counts[it.key]} /> : null}</a>;
          })}
          {more.length ? (
            <span style={{ position: 'relative' }}>
              <button type="button" className={'sv-site-header__link' + (moreActive ? ' is-active' : '') + (open ? ' is-open' : '')} aria-haspopup="menu" aria-expanded={open} onClick={function () { setOpen(!open); }}>Ещё<Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} /></button>
              {open ? <MegaMenu title="Управление" items={more.map(function (it) { return { key: it.key, label: it.label, icon: it.icon, sub: MORE_SUB[it.key], active: it.key === props.active, count: counts[it.key] }; })}
                links={[{ label: 'Профиль', href: '#profile' }, { label: 'Как работать', href: '#help' }, { label: 'Выйти', href: '#logout' }]} onPick={function (k) { setOpen(false); props.onSelect && props.onSelect(k); }} /> : null}
            </span>
          ) : null}
        </nav>
        <div className="sv-site-header__actions">
          {props.team !== null ? <TeamSwitcher compact {...(props.team || {})} /> : null}
          {props.week !== null ? <WeekSwitcher {...(props.week || {})} /> : null}
          <button type="button" className="sv-topbar__search" onClick={props.onSearch} aria-label="Поиск, открывает командную строку"><Icon name="search" size={18} /><span>Поиск</span><Kbd>⌘K</Kbd></button>
          <Button variant="dark" size="sm" icon="plus" onClick={props.onNewTask}><span>Новая задача</span></Button>
          <button type="button" className="sv-icon-btn sv-icon-btn--sm" aria-label={'Профиль: ' + (props.userName || 'Арам Мурадян')} onClick={props.onProfile} style={{ padding: 0 }}><Avatar name={props.userName || 'Арам Мурадян'} size="md" /></button>
        </div>
      </div>
      {props.children ? <div className="sv-site-header__sub"><div className="sv-site-header__row">{props.children}</div></div> : null}
    </header>
  );
}
var MORE_SUB = { ceo: 'Черновик письма за неделю', analytics: 'Сдача, обещания, просрочка', journal: 'Кто, что, когда', settings: 'Справочники, люди, сроки', sync: 'Таблица и выгрузки', structure: 'Дерево департамента' };
