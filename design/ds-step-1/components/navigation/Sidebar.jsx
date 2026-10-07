import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { CounterBadge } from '../core/CounterBadge.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { IconButton } from '../core/IconButton.jsx';
import { Logo } from '../core/Logo.jsx';

/* Боковое меню 248. items: [{ key, label, icon, count, group }], группа «Управление» видна владельцу и администраторам.
   variant: dark (тёмно-синее) или light (как шапка сайта). Внизу профиль: имя, роль, тема, выход. Официальный логотип Сравни (Logo), рядом название продукта и подпись департамента. */
export var SIDEBAR_ITEMS = [
  { key: 'week', label: 'Моя неделя', icon: 'calendar-days' },
  { key: 'inbox', label: 'Мне', icon: 'inbox' },
  { key: 'teams', label: 'Мои команды', icon: 'users', managerOnly: true },
  { key: 'weekly', label: 'Weekly', icon: 'file-text' },
  { key: 'tasks', label: 'Задачи', icon: 'check-square' },
  { key: 'meetings', label: 'Встречи', icon: 'presentation' },
  { key: 'goals', label: 'Цели', icon: 'target' },
  { key: 'team', label: 'Команда', icon: 'contact' },
  { key: 'ceo', label: 'Отчёт CEO', icon: 'mail', group: 'Управление' },
  { key: 'analytics', label: 'Аналитика', icon: 'bar-chart-3', group: 'Управление' },
  { key: 'journal', label: 'Журнал', icon: 'scroll-text', group: 'Управление' },
  { key: 'settings', label: 'Настройки', icon: 'settings', group: 'Управление' },
  { key: 'sync', label: 'Синхронизация', icon: 'refresh-cw', group: 'Управление' }
];
export function Sidebar(props) {
  var items = props.items || SIDEBAR_ITEMS;
  var counts = props.counts || {};
  var isManager = props.isManager !== false;
  var isAdmin = props.isAdmin !== false;
  var light = props.variant === 'light';
  var groups = [];
  items.forEach(function (it) {
    if (it.managerOnly && !isManager) return;
    if (it.group && !isAdmin) return;
    var g = groups.filter(function (x) { return x.name === (it.group || ''); })[0];
    if (!g) { g = { name: it.group || '', items: [] }; groups.push(g); }
    g.items.push(it);
  });
  return (
    <nav className={'sv-sidebar' + (light ? ' sv-sidebar--light' : '')} aria-label="Разделы" style={props.style}>
      <a className="sv-sidebar__skip" href="#content">Перейти к содержимому</a>
      <div className="sv-sidebar__brand">
        {props.logo || <Logo variant={light ? 'color' : 'white'} height={24} />}
        {props.logo ? null : <span className="sv-sidebar__sign"><Logo variant={light ? 'color' : 'white'} height={26} sign /></span>}
        <span className="sv-sidebar__divider" />
        <div style={{ minWidth: 0 }}><div className="sv-sidebar__title">Weekly</div><div className="sv-sidebar__sub">Страхование и инвестиции</div></div>
      </div>
      {groups.map(function (g) {
        return (
          <div key={g.name || 'main'}>
            {g.name ? <div className="sv-sidebar__group">{g.name}</div> : null}
            <div className="sv-sidebar__nav">
              {g.items.map(function (it) {
                var active = it.key === props.active;
                return (
                  <a key={it.key} href={props.hrefFor ? props.hrefFor(it.key) : '#' + it.key} className={'sv-sidebar__item' + (active ? ' is-active' : '')} aria-current={active ? 'page' : undefined}
                    onClick={function (e) { if (props.onSelect) { e.preventDefault(); props.onSelect(it.key); } }}>
                    <Icon name={it.icon} size={20} /><span className="sv-sidebar__item__label">{it.label}</span>
                    {counts[it.key] ? <CounterBadge value={counts[it.key]} tone={light ? 'accent' : 'inverse'} /> : null}
                  </a>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="sv-sidebar__spacer" />
      <div className="sv-sidebar__profile">
        <Avatar name={props.userName || 'Арам Мурадян'} size="md" />
        <div style={{ minWidth: 0, flex: 1 }}><div className="sv-sidebar__profile__name">{props.userName || 'Арам Мурадян'}</div><div className="sv-sidebar__profile__role">{props.userRole || 'Владелец'}</div></div>
        <IconButton icon={props.dark ? 'sun' : 'moon'} label={props.dark ? 'Светлая тема' : 'Тёмная тема'} size="sm" variant={light ? undefined : 'inverse'} onClick={props.onToggleTheme} />
        <IconButton icon="log-out" label="Выйти" size="sm" variant={light ? undefined : 'inverse'} onClick={props.onLogout} />
      </div>
    </nav>
  );
}
