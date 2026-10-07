import React from 'react';
import { Avatar } from '../core/Avatar.jsx';
import { StatusBadge } from '../core/StatusBadge.jsx';
import { CounterBadge } from '../core/CounterBadge.jsx';
import { Button } from '../core/Button.jsx';

/* Блок «Жду от коллег»: мои просьбы с состоянием. items: [{ id, to, text, status, due }]. Пустое: «Просьб нет» и «Попросить коллегу». */
export function WaitingBlock(props) {
  var items = props.items || [];
  return (
    <section className="sv-waiting" style={props.style} aria-label="Жду от коллег">
      <header className="sv-waiting__head">Жду от коллег{items.length ? <CounterBadge value={items.length} tone="neutral" /> : null}{props.allHref && items.length ? <a href={props.allHref}>Все</a> : null}</header>
      {items.length === 0 ? <div className="sv-waiting__empty"><span>Просьб нет</span><Button size="sm" variant="secondary" icon="hand" onClick={props.onAsk}>Попросить коллегу</Button></div> : null}
      {items.map(function (it) {
        return (
          <div key={it.id} className="sv-waiting__row" onClick={function () { props.onOpen && props.onOpen(it); }}>
            <Avatar name={it.to} size="md" />
            <div style={{ minWidth: 0 }}><div className="sv-waiting__text">{it.text}</div><div className="sv-waiting__sub">{it.to}{it.due ? ', до ' + it.due : ''}</div></div>
            <StatusBadge request={it.status} />
          </div>
        );
      })}
    </section>
  );
}
