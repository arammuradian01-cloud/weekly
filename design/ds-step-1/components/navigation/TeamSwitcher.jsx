import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Переключатель команд в верхней панели слева от недели. teams: [{ id, name, role: 'lead' | 'member', sub }], плюс «Все мои команды» у руководителей.
   Выбор запоминается. compact: вид для шапки раздела на телефоне. */
export function TeamSwitcher(props) {
  var st = React.useState(!!props.open);
  var open = st[0], setOpen = st[1];
  var teams = props.teams || [{ id: 'top', name: 'Топ-команда', role: 'lead', sub: 'Арам Мурадян, 9 человек' }];
  var value = props.value || teams[0].id;
  var current = teams.filter(function (t) { return t.id === value; })[0] || (value === 'all' ? { name: 'Все мои команды' } : teams[0]);
  function pick(id) { props.onChange && props.onChange(id); if (!props.open) setOpen(false); }
  return (
    <div className={'sv-team-switch' + (props.compact ? ' sv-team-switch--compact' : '')} style={props.style}>
      <button type="button" className={'sv-team-switch__trigger' + (open ? ' is-open' : '')} aria-haspopup="listbox" aria-expanded={open} onClick={function () { setOpen(!open); }}>
        <Icon name="users" size={18} className="sv-icon--secondary" />
        <span className="sv-team-switch__name">{current.name}</span>
        {current.role === 'lead' && !props.compact ? <span className="sv-team-switch__role">руководитель</span> : null}
        <Icon name="chevron-down" size={18} className="sv-icon--secondary" />
      </button>
      {open ? (
        <div className={'sv-menu' + (props.staticMenu ? ' sv-menu--static' : '')} role="listbox">
          {props.showAll ? <button type="button" role="option" aria-selected={value === 'all'} className={'sv-menu__item' + (value === 'all' ? ' is-selected' : '')} onClick={function () { pick('all'); }}>
            <Icon name="layers" size={18} /><span className="sv-menu__item__body"><span>Все мои команды</span><span className="sv-menu__item__sub">Задачи и weekly всего поддерева</span></span>{value === 'all' ? <Icon name="check" size={18} className="sv-menu__item__check" /> : null}</button> : null}
          {props.showAll ? <div className="sv-menu__sep" /> : null}
          {teams.map(function (t) {
            var sel = t.id === value;
            return (
              <button type="button" key={t.id} role="option" aria-selected={sel} className={'sv-menu__item' + (sel ? ' is-selected' : '')} onClick={function () { pick(t.id); }}>
                <span className={'sv-team-switch__dot sv-team-switch__dot--' + (t.role || 'member')} />
                <span className="sv-menu__item__body"><span>{t.name}</span><span className="sv-menu__item__sub">{(t.role === 'lead' ? 'Вы руководитель' : 'Вы участник') + (t.sub ? ', ' + t.sub : '')}</span></span>
                {sel ? <Icon name="check" size={18} className="sv-menu__item__check" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
