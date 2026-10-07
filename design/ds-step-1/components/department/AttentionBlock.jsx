import React from 'react';
import { Avatar } from '../core/Avatar.jsx';
import { Button } from '../core/Button.jsx';
import { Icon } from '../core/Icon.jsx';
import { CounterBadge } from '../core/CounterBadge.jsx';

/* Блок «Требует внимания»: 5-7 задач команды, которые просрочены, давно не обновлялись или заблокированы, с ответственным и кнопкой «Попросить обновить».
   items: [{ id, title, owner, why: 'overdue' | 'stale' | 'blocked', whyText, asked }]. */
export function AttentionBlock(props) {
  var items = props.items || [];
  return (
    <section className="sv-attention" style={props.style} aria-label="Требует внимания">
      <header className="sv-attention__head"><Icon name="alert-circle" size={18} style={{ color: 'var(--color-danger-text)' }} />Требует внимания<CounterBadge value={items.length} tone="neutral" /></header>
      {items.length === 0 ? <div style={{ padding: '20px 16px', color: 'var(--color-text-secondary)', fontSize: 'var(--text-body)' }}>Все задачи команды в порядке</div> : null}
      {items.map(function (it) {
        return (
          <div key={it.id} className={'sv-attention__row' + (it.leaving ? ' is-leaving' : '')}>
            <div style={{ minWidth: 0 }}>
              <div className="sv-task__title">№{it.id} {it.title}</div>
              <span className={'sv-attention__why' + (it.why === 'stale' ? ' sv-attention__why--stale' : '')}>{it.whyText}</span>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}><Avatar name={it.owner} size="sm" />{it.owner}</span>
            {it.asked ? <span className="sv-saved"><Icon name="check" size={14} />Попросили {it.asked}</span> : <Button size="sm" variant="outline" icon="refresh-cw" onClick={function () { props.onAsk && props.onAsk(it); }}>Попросить обновить</Button>}
          </div>
        );
      })}
    </section>
  );
}
