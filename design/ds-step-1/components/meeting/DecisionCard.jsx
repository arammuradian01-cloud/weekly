import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { StatusBadge } from '../core/StatusBadge.jsx';

/* Карточка решения: формулировка, владелец, дата встречи, связанные задачи, статус «в силе» или «отменено».
   decision: { text, owner, date, tasks: [{ id, title }], cancelled, cancelledBy, cancelledAt, protocol }. */
export function DecisionCard(props) {
  var d = props.decision || {};
  return (
    <article className={'sv-decision' + (d.cancelled ? ' is-cancelled' : '')} style={props.style} onClick={props.onOpen}>
      <div className="sv-decision__head"><Icon name="gavel" size={16} />Решение{d.date ? ', встреча ' + d.date : ''}<span style={{ marginLeft: 'auto' }}><StatusBadge tone={d.cancelled ? 'neutral' : 'success'} dot>{d.cancelled ? 'Отменено' : 'В силе'}</StatusBadge></span></div>
      <p className="sv-decision__text">{d.text}</p>
      <div className="sv-decision__meta">
        {d.owner ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Avatar name={d.owner} size="xs" />{d.owner}</span> : null}
        {(d.tasks || []).map(function (t) { return <a key={t.id} href="#"><Icon name="check-square" size={12} style={{ verticalAlign: -1, marginRight: 4 }} />№{t.id} {t.title}</a>; })}
        {d.protocol ? <a href="#"><Icon name="file-text" size={12} style={{ verticalAlign: -1, marginRight: 4 }} />Протокол</a> : null}
        {d.cancelled ? <span>Отменил {d.cancelledBy}{d.cancelledAt ? ', ' + d.cancelledAt : ''}</span> : null}
      </div>
    </article>
  );
}
