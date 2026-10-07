import React from 'react';
import { IconCircle } from '../core/Icon.jsx';

/* Пустое состояние: иконка на тонированном круге, заголовок, одна фраза и одно действие. compact: в строку для блоков. illustration: место под спокойную иллюстрацию (только пустые состояния и вход). */
export function EmptyState(props) {
  return (
    <div className={'sv-empty' + (props.compact ? ' sv-empty--compact' : '')} style={props.style}>
      {props.illustration ? <div className="sv-empty__illustration">иллюстрация</div> : <IconCircle name={props.icon || 'inbox'} tone={props.tone || 'neutral'} size={props.compact ? 40 : 56} />}
      <div>
        <h3 className="sv-empty__title">{props.title}</h3>
        {props.children ? <p className="sv-empty__text">{props.children}</p> : null}
      </div>
      {props.action ? <div className="sv-empty__action">{props.action}</div> : null}
    </div>
  );
}
