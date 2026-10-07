import React from 'react';

/* Состояние задачи: ok «В графике», risk «Есть риск», blocked «Заблокирована», none «Не задано».
   outside: «зелёное снаружи», пунктирная обводка и подсказка почему. */
export var STATE = { ok: 'В графике', risk: 'Есть риск', blocked: 'Заблокирована', none: 'Не задано' };
export function StateDot(props) {
  var state = props.state || 'none';
  var cls = ['sv-state', 'sv-state--' + state, props.outside ? 'sv-state--outside' : ''].filter(Boolean).join(' ');
  return (
    <span className={cls} title={props.outside ? ('Зелёное снаружи: ' + props.outside) : STATE[state]}>
      <span className="sv-state__dot" />
      {props.compact ? null : (props.children || STATE[state])}
    </span>
  );
}
