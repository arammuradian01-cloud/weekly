import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Button } from '../core/Button.jsx';

/* Подсказка из черновика фактов сбоку от записей: что ресурс заметил за неделю (закрытая задача, смена статуса, реакция), с кнопкой «Добавить».
   hint: { source, text, added }. */
export function DraftHint(props) {
  var h = props.hint || {};
  return (
    <div className={'sv-draft-hint' + (h.added ? ' is-added' : '')} style={props.style}>
      <span className="sv-draft-hint__src"><Icon name={h.icon || 'sparkles'} size={14} />{h.source}</span>
      <p className="sv-draft-hint__text">{h.text}</p>
      <div className="sv-draft-hint__actions">
        {h.added ? <span className="sv-saved"><Icon name="check" size={14} />Добавлено</span> : [<Button key="a" size="sm" variant="secondary" icon="plus" onClick={props.onAdd}>Добавить</Button>, <Button key="s" size="sm" variant="text" onClick={props.onSkip}>Пропустить</Button>]}
      </div>
    </div>
  );
}
