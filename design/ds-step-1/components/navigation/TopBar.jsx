import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Kbd } from '../core/Kbd.jsx';
import { Button } from '../core/Button.jsx';
import { TeamSwitcher } from './TeamSwitcher.jsx';
import { WeekSwitcher } from './WeekSwitcher.jsx';

/* Верхняя панель: переключатель команд (слева от недели), переключатель недели, поиск (Cmd+K), кнопка «Новая задача».
   mac: подсказка ⌘K вместо Ctrl K. */
export function TopBar(props) {
  return (
    <header className={'sv-topbar' + (props.surface ? ' sv-topbar--surface' : '')} style={props.style}>
      {props.leading}
      {props.team !== null ? <TeamSwitcher {...(props.team || {})} /> : null}
      <WeekSwitcher {...(props.week || {})} />
      <div className="sv-topbar__spacer" />
      <button type="button" className="sv-topbar__search" onClick={props.onSearch} aria-label="Поиск, открывает командную строку">
        <Icon name="search" size={18} /><span>Поиск</span><Kbd>{props.mac === false ? 'Ctrl K' : '⌘K'}</Kbd>
      </button>
      <Button variant="dark" icon="plus" onClick={props.onNewTask} size="sm"><span>Новая задача</span></Button>
      {props.trailing}
    </header>
  );
}
