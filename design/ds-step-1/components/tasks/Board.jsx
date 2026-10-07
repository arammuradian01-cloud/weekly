import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { CounterBadge } from '../core/CounterBadge.jsx';
import { OverdueLabel } from '../core/OverdueLabel.jsx';
import { PriorityMark } from '../core/PriorityMark.jsx';

/* Колонка статуса и карточка задачи для доски и вида «По статусам». Полоска слева показывает состояние: ok, risk, blocked.
   BoardCard: { id, title, owner, due, overdueDays, state, blocked, priority, dragging, placeholder }. */
var TONE = { proposed: 'var(--color-info-dot)', progress: 'var(--color-accent)', clarify: 'var(--color-warning-dot)', done: 'var(--color-success-dot)', failed: 'var(--color-danger-dot)', cancelled: 'var(--color-neutral-dot)' };
export function BoardColumn(props) {
  var count = props.count != null ? props.count : React.Children.count(props.children);
  return (
    <section className={'sv-board__col' + (props.over ? ' is-over' : '')} aria-label={props.title} style={props.style}>
      <header className="sv-board__head"><span className="sv-badge__dot" style={{ background: TONE[props.status] || 'var(--color-neutral-dot)' }} />{props.title}<CounterBadge value={count} tone="neutral" /></header>
      {count === 0 && !props.children ? <div className="sv-board__empty">{props.emptyText || 'Пусто'}</div> : props.children}
    </section>
  );
}
export function BoardCard(props) {
  var t = props.task || props;
  return (
    <article className={['sv-card-task', t.dragging ? 'is-dragging' : '', t.placeholder ? 'is-placeholder' : ''].filter(Boolean).join(' ')} tabIndex={0} draggable aria-roledescription="перетаскиваемая карточка" onClick={props.onOpen} style={props.style}>
      <span className={'sv-card-task__stripe sv-card-task__stripe--' + (t.state || 'none')} />
      <div className="sv-card-task__top"><span>№{t.id}</span>{t.priority && t.priority !== 'none' ? <PriorityMark level={t.priority} compact /> : null}{t.blocked ? <span className="sv-card-task__blocker" title="Есть блокер"><Icon name="octagon-alert" size={14} /></span> : null}</div>
      <div className="sv-card-task__title">{t.title}</div>
      <div className="sv-card-task__bottom">
        <span className="sv-card-task__meta"><Avatar name={t.owner} size="xs" /><span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>{t.owner}</span></span>
        <OverdueLabel date={t.due} days={t.overdueDays} soon={t.soon} />
      </div>
    </article>
  );
}
export function Board(props) {
  return <div className="sv-board" style={props.style}>{props.children}</div>;
}
