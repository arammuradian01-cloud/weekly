import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Input } from '../forms/Input.jsx';
import { Button } from '../core/Button.jsx';

/* Строка обещания с итогом: четыре кнопки итога (сделано, частично, не сделано, снято), поле на одну фразу и «Перенести на эту неделю».
   promise: { id, text, from, outcome, note }. readonly: итог без кнопок (лента, профиль). */
export var OUTCOMES = [
  { key: 'done', label: 'Сделано', icon: 'check' },
  { key: 'partial', label: 'Частично', icon: 'circle-dot' },
  { key: 'failed', label: 'Не сделано', icon: 'x' },
  { key: 'dropped', label: 'Снято', icon: 'minus' }
];
export function PromiseRow(props) {
  var p = props.promise || {};
  var o = OUTCOMES.filter(function (x) { return x.key === p.outcome; })[0];
  return (
    <div className={'sv-promise' + (props.readonly ? ' sv-promise--readonly' : '')} style={props.style}>
      <div className="sv-promise__text">{p.text}{p.from ? <small>{p.from}</small> : null}</div>
      {props.readonly ? (
        <span className={'sv-promise__result sv-promise__result--' + (p.outcome || 'none')}>{o ? <Icon name={o.icon} size={14} /> : null}{o ? o.label : 'Без итога'}</span>
      ) : (
        <div className="sv-promise__outcome" role="radiogroup" aria-label="Итог">
          {OUTCOMES.map(function (x) {
            var active = p.outcome === x.key;
            return <button type="button" key={x.key} role="radio" aria-checked={active} className={['sv-promise__opt', active ? 'is-active is-' + x.key : ''].filter(Boolean).join(' ')} onClick={function () { props.onOutcome && props.onOutcome(p, x.key); }}><Icon name={x.icon} size={14} />{x.label}</button>;
          })}
        </div>
      )}
      {!props.readonly && p.outcome && p.outcome !== 'done' ? (
        <div className="sv-promise__more">
          <Input size="sm" placeholder="Одной фразой: что помешало или что осталось" value={p.note || ''} onChange={function (e) { props.onNote && props.onNote(p, e.target.value); }} />
          {p.outcome !== 'dropped' ? <Button size="sm" variant="secondary" icon="arrow-right" onClick={function () { props.onCarry && props.onCarry(p); }}>Перенести на эту неделю</Button> : null}
        </div>
      ) : null}
      {props.readonly && p.note ? <div className="sv-promise__more" style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>{p.note}</div> : null}
    </div>
  );
}
