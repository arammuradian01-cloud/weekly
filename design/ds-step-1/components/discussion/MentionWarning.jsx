import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Предупреждение автору: «Упоминание не дошло: Никита Т. не видит эту задачу». names: массив имён, subject: «эту задачу» или «эту запись». */
export function MentionWarning(props) {
  var names = props.names || [];
  var verb = names.length > 1 ? 'не видят' : 'не видит';
  return (
    <div className="sv-mention-warn" role="status">
      <Icon name="alert-triangle" size={16} />
      <span>Упоминание не дошло: {names.join(', ')} {verb} {props.subject || 'эту задачу'}.{props.hint ? ' ' + props.hint : ''}</span>
    </div>
  );
}
