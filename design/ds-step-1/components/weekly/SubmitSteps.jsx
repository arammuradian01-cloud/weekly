import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Шаги сдачи weekly: «Что обещал», «Задачи», «Главное и записи», «Проверить и сдать». Слева на ноутбуке (vertical), сверху на телефоне (row).
   steps: [{ key, label, sub }], current: ключ текущего, done: массив пройденных. */
export var SUBMIT_STEPS = [
  { key: 'promises', label: 'Что обещал', sub: '5 обещаний' },
  { key: 'tasks', label: 'Задачи', sub: '4 требуют внимания' },
  { key: 'entries', label: 'Главное и записи', sub: 'до 7 записей' },
  { key: 'review', label: 'Проверить и сдать' }
];
export function SubmitSteps(props) {
  var steps = props.steps || SUBMIT_STEPS;
  var done = props.done || [];
  return (
    <nav className={'sv-steps' + (props.row ? ' sv-steps--row' : '')} aria-label="Шаги сдачи" style={props.style}>
      {steps.map(function (s, i) {
        var isDone = done.indexOf(s.key) !== -1;
        var active = s.key === props.current;
        return (
          <button type="button" key={s.key} className={['sv-step', active ? 'is-active' : '', isDone ? 'is-done' : ''].filter(Boolean).join(' ')} aria-current={active ? 'step' : undefined} onClick={function () { props.onSelect && props.onSelect(s.key); }}>
            <span className="sv-step__n">{isDone ? <Icon name="check" size={14} strokeWidth={2.5} /> : i + 1}</span>
            <span className="sv-step__body"><span>{s.label}</span>{s.sub && !props.row ? <span className="sv-step__sub">{s.sub}</span> : null}</span>
          </button>
        );
      })}
    </nav>
  );
}
