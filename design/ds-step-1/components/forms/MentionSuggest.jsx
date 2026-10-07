import React from 'react';
import { Avatar } from '../core/Avatar.jsx';
import { Kbd } from '../core/Kbd.jsx';

/* Подсказка @упоминания под полем ввода: аватар, имя и должность, выбор стрелками и Enter.
   people: [{ id, name, role }], query: введённое после @, activeIndex: выделенный. */
export function MentionSuggest(props) {
  var q = (props.query || '').toLowerCase();
  var list = (props.people || []).filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) === 0 || p.name.toLowerCase().indexOf(' ' + q) !== -1; }).slice(0, 6);
  var active = props.activeIndex || 0;
  return (
    <div className={'sv-menu sv-mention-suggest' + (props.staticMenu ? ' sv-menu--static' : '')} role="listbox" aria-label="Кого упомянуть">
      {list.length === 0 ? <div className="sv-menu__empty">Никого с таким именем</div> : null}
      {list.map(function (p, i) {
        return (
          <button type="button" key={p.id} role="option" aria-selected={i === active} className={'sv-menu__item' + (i === active ? ' is-active' : '')} onClick={function () { props.onPick && props.onPick(p); }}>
            <Avatar name={p.name} size="sm" />
            <span className="sv-menu__item__body"><span>{p.name}</span><span className="sv-menu__item__sub">{p.role}</span></span>
            {i === active ? <Kbd>Enter</Kbd> : null}
          </button>
        );
      })}
    </div>
  );
}
/* Упомянутое имя в тексте */
export function Mention(props) {
  return <span className="sv-mention">@{props.children}</span>;
}
