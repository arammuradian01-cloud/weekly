import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { CounterBadge } from '../core/CounterBadge.jsx';

/* Нижнее меню на телефоне, пять пунктов: Моя неделя, Мне, Weekly, Задачи, Ещё. У руководителя «Мои команды» вместо «Weekly» (manager). */
export function BottomNav(props) {
  var items = props.items || [
    { key: 'week', label: 'Моя неделя', icon: 'calendar-days' },
    { key: 'inbox', label: 'Мне', icon: 'inbox' },
    props.manager ? { key: 'teams', label: 'Мои команды', icon: 'users' } : { key: 'weekly', label: 'Weekly', icon: 'file-text' },
    { key: 'tasks', label: 'Задачи', icon: 'check-square' },
    { key: 'more', label: 'Ещё', icon: 'menu' }
  ];
  var counts = props.counts || {};
  return (
    <nav className="sv-bottom-nav" aria-label="Разделы" style={props.style}>
      {items.map(function (it) {
        var active = it.key === props.active;
        return (
          <button type="button" key={it.key} className={'sv-bottom-nav__item' + (active ? ' is-active' : '')} aria-current={active ? 'page' : undefined} onClick={function () { props.onSelect && props.onSelect(it.key); }}>
            <span className="sv-bottom-nav__icon"><Icon name={it.icon} size={22} />{counts[it.key] ? <CounterBadge value={counts[it.key]} /> : null}</span>
            {it.label}
          </button>
        );
      })}
    </nav>
  );
}
