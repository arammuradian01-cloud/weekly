import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';
import { Button } from '../core/Button.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { StatusBadge } from '../core/StatusBadge.jsx';

/* Пункт повестки в списке подготовки: источник (задача, запись, просьба), автор, вопрос одной фразой, примерное время, действия убрать и отложить.
   item: { n, title, source, sourceLabel, author, minutes, current, done, status }. AgendaItemBig: пункт на проекторе с контекстом. */
var SRC = { task: 'check-square', entry: 'file-text', request: 'hand', question: 'presentation', promise: 'flag' };
export function AgendaItem(props) {
  var it = props.item || {};
  return (
    <div className={['sv-agenda-item', it.current ? 'is-current' : '', it.done ? 'is-done' : '', it.dragging ? 'is-dragging' : ''].filter(Boolean).join(' ')} style={props.style}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        {props.draggable !== false ? <span className="sv-agenda-item__grip" aria-label="Перетащить"><Icon name="grip-vertical" size={16} /></span> : null}
        <span className="sv-agenda-item__n">{it.n}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <p className="sv-agenda-item__title">{it.title}</p>
        <div className="sv-agenda-item__meta">
          {it.sourceLabel ? <a href="#"><Icon name={SRC[it.source] || 'link'} size={12} style={{ verticalAlign: -1, marginRight: 4 }} />{it.sourceLabel}</a> : null}
          {it.author ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Avatar name={it.author} size="xs" />{it.author}</span> : null}
          {it.status ? <StatusBadge task={it.status} /> : null}
        </div>
      </div>
      <div className="sv-agenda-item__side">
        {it.minutes ? <span className="sv-agenda-item__time">{it.minutes} мин</span> : null}
        {props.onRemove || props.onDefer ? <div className="sv-agenda-item__actions">
          {props.onDefer ? <IconButton icon="calendar-arrow-down" label="Отложить на следующую неделю" size="sm" onClick={function () { props.onDefer(it); }} /> : null}
          {props.onRemove ? <IconButton icon="x" label="Убрать из повестки" size="sm" onClick={function () { props.onRemove(it); }} /> : null}
        </div> : null}
      </div>
    </div>
  );
}
export function AgendaItemBig(props) {
  var it = props.item || {};
  var ctx = it.context || [];
  return (
    <section className="sv-agenda-big" style={props.style} aria-label={'Пункт ' + it.n}>
      <div className="sv-agenda-big__kicker"><span>Пункт {it.n} из {it.total}</span>{it.section ? <span>{it.section}</span> : null}{it.author ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Avatar name={it.author} size="sm" />{it.author}</span> : null}</div>
      <h2 className="sv-agenda-big__title">{it.title}</h2>
      {ctx.length ? <div className="sv-agenda-big__ctx">{ctx.map(function (c, i) { return <div key={i} className="sv-agenda-big__cell"><small>{c.label}</small><span>{c.value}</span></div>; })}</div> : null}
      <div className="sv-agenda-big__actions">
        <Button variant="dark" icon="gavel" hotkey="R" onClick={props.onDecision}>Записать решение</Button>
        <Button variant="outline" icon="plus" hotkey="T" onClick={props.onTask}>Поставить задачу</Button>
        {props.onStatus ? <Button variant="outline" icon="circle-dot" onClick={props.onStatus}>Сменить статус</Button> : null}
        {props.onDue ? <Button variant="outline" icon="calendar" onClick={props.onDue}>Перенести срок</Button> : null}
        <Button variant="secondary" icon="check" onClick={props.onDone}>Обсуждено</Button>
      </div>
    </section>
  );
}
