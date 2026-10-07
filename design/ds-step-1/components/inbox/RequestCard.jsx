import React from 'react';
import { Avatar } from '../core/Avatar.jsx';
import { Icon } from '../core/Icon.jsx';
import { Button } from '../core/Button.jsx';
import { StatusBadge } from '../core/StatusBadge.jsx';

/* Карточка просьбы: кто, кому, что, к какому сроку, связанная задача, ответ.
   request: { from, to, text, due, status: waiting | accepted | done | declined | overdue, task, answer: { by, text, due } }.
   role: recipient (адресат: «Принять и назвать срок», «Отклонить с причиной», «Выполнено», «Сделать задачей») или author («Отозвать», «Напомнить»). */
export function RequestCard(props) {
  var r = props.request || {};
  var role = props.role || 'recipient';
  return (
    <article className={['sv-request', r.status === 'overdue' ? 'is-overdue' : '', r.status === 'done' ? 'is-done' : ''].filter(Boolean).join(' ')} style={props.style}>
      <div className="sv-request__head">
        <span className="sv-request__who"><Avatar name={r.from} size="sm" /><b>{r.from}</b><Icon name="arrow-right" size={14} className="sv-request__arrow" /><Avatar name={r.to} size="sm" /><b>{r.to}</b></span>
        <span style={{ marginLeft: 'auto' }}><StatusBadge request={r.status || 'waiting'} /></span>
      </div>
      <p className="sv-request__text">{r.text}</p>
      <div className="sv-request__meta">
        {r.due ? <span><Icon name="calendar" size={14} style={{ verticalAlign: -2, marginRight: 4 }} />{r.due}</span> : null}
        {r.task ? <a href="#"><Icon name="check-square" size={14} style={{ verticalAlign: -2, marginRight: 4 }} />{r.task}</a> : null}
        {r.created ? <span>{r.created}</span> : null}
      </div>
      {r.answer ? <div className="sv-request__answer"><b>{r.answer.by}:</b> {r.answer.text}{r.answer.due ? <span style={{ color: 'var(--color-text-secondary)' }}>, срок {r.answer.due}</span> : null}</div> : null}
      {r.status === 'waiting' || r.status === 'overdue' || r.status === 'accepted' ? (
        <div className="sv-request__actions">
          {role === 'recipient' && r.status !== 'accepted' ? [<Button key="a" variant="primary" size="sm" icon="check" onClick={props.onAccept}>Принять и назвать срок</Button>, <Button key="d" variant="outline" size="sm" onClick={props.onDecline}>Отклонить с причиной</Button>] : null}
          {role === 'recipient' && r.status === 'accepted' ? <Button variant="primary" size="sm" icon="check" onClick={props.onDone}>Выполнено</Button> : null}
          {role === 'recipient' ? <Button variant="text" size="sm" icon="list-plus" onClick={props.onToTask}>Сделать задачей</Button> : null}
          {role === 'author' ? [<Button key="r" variant="outline" size="sm" icon="bell" onClick={props.onRemind}>Напомнить</Button>, <Button key="w" variant="text" size="sm" onClick={props.onWithdraw}>Отозвать</Button>] : null}
        </div>
      ) : null}
    </article>
  );
}
