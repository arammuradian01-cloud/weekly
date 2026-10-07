import React from 'react';
import { Icon } from './Icon.jsx';

/* Тег. kind: default (направление, блок), result | event | risk | plan (тип записи), ceo («В отчёт CEO»), help («Нужна помощь»),
   question («Вопрос к встрече»), up («Наверх»). onRemove добавляет крестик. */
export var ENTRY_TYPE = { result: 'Результат', event: 'Событие', risk: 'Риск', plan: 'План' };
export function Tag(props) {
  var kind = props.kind || 'default';
  var label = props.children || (kind === 'ceo' ? 'В отчёт CEO' : kind === 'help' ? 'Нужна помощь' : kind === 'question' ? 'Вопрос к встрече' : kind === 'up' ? 'Наверх' : ENTRY_TYPE[kind] || '');
  var icon = props.icon || (kind === 'ceo' ? 'flag' : kind === 'help' ? 'hand' : kind === 'question' ? 'message-circle-question' : kind === 'up' ? 'arrow-up' : null);
  return (
    <span className={['sv-tag', kind !== 'default' ? 'sv-tag--' + kind : '', props.onRemove ? 'sv-tag--removable' : '', props.className || ''].filter(Boolean).join(' ')}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {label}
      {props.onRemove ? <button type="button" className="sv-tag__remove" aria-label={'Убрать ' + label} onClick={props.onRemove}><Icon name="x" size={12} /></button> : null}
    </span>
  );
}
