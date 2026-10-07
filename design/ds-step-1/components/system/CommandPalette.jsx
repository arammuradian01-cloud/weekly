import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Kbd } from '../core/Kbd.jsx';
import { Avatar } from '../core/Avatar.jsx';

/* Командная строка Cmd+K: поиск по задачам, записям, решениям и людям; быстрые действия с подсказкой клавиш. Результаты сгруппированы по типу.
   groups: [{ name, items: [{ key, label, sub, icon, person, hotkey }] }]. query, activeKey. */
export var CMDK_ACTIONS = { name: 'Действия', items: [
  { key: 'new-task', label: 'Новая задача', icon: 'plus', hotkey: 'N' },
  { key: 'ask', label: 'Попросить коллегу', icon: 'hand', hotkey: 'A' },
  { key: 'submit', label: 'Сдать weekly', icon: 'send', hotkey: 'W' },
  { key: 'week', label: 'Перейти к неделе', icon: 'calendar-days', hotkey: 'G' }
] };
function mark(text, q) {
  if (!q) return text;
  var i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return text;
  return [text.slice(0, i), <mark key="m">{text.slice(i, i + q.length)}</mark>, text.slice(i + q.length)];
}
export function CommandPalette(props) {
  var qs = React.useState(props.query || '');
  var q = qs[0];
  var groups = props.groups || [CMDK_ACTIONS];
  var any = groups.some(function (g) { return g.items.length; });
  return (
    <div className="sv-cmdk" role="dialog" aria-label="Командная строка" style={props.style}>
      <div className="sv-cmdk__input"><Icon name="search" size={20} /><input autoFocus={props.autoFocus} value={q} onChange={function (e) { qs[1](e.target.value); props.onQuery && props.onQuery(e.target.value); }} placeholder="Задача, запись, решение, человек или действие" aria-label="Поиск" /><Kbd>Esc</Kbd></div>
      <div className="sv-cmdk__list" role="listbox">
        {!any ? <div className="sv-cmdk__empty">Ничего не нашлось по «{q}»</div> : null}
        {groups.map(function (g) {
          if (!g.items.length) return null;
          return (
            <div key={g.name}>
              <div className="sv-cmdk__group">{g.name}</div>
              {g.items.map(function (it) {
                return (
                  <button type="button" key={it.key} role="option" aria-selected={it.key === props.activeKey} className={'sv-cmdk__item' + (it.key === props.activeKey ? ' is-active' : '')} onClick={function () { props.onPick && props.onPick(it); }}>
                    {it.person ? <Avatar name={it.label} size="sm" /> : <Icon name={it.icon || 'file-text'} size={18} />}
                    <span className="sv-cmdk__body"><span>{mark(it.label, q)}</span>{it.sub ? <span className="sv-cmdk__sub">{it.sub}</span> : null}</span>
                    {it.hotkey ? <Kbd>{it.hotkey}</Kbd> : null}
                    {it.key === props.activeKey ? <Kbd>Enter</Kbd> : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="sv-cmdk__foot"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> выбрать</span><span><Kbd>Enter</Kbd> открыть</span><span><Kbd>⌘</Kbd><Kbd>Enter</Kbd> в новой панели</span></div>
    </div>
  );
}
