import React from 'react';
import { Avatar } from './Avatar.jsx';

/* Группа аватаров внахлёст; max задаёт, сколько показать, остальные «+N». names: массив имён. */
export function AvatarGroup(props) {
  var max = props.max || 4;
  var names = props.names || [];
  var shown = names.slice(0, max);
  var rest = names.length - shown.length;
  return (
    <span className="sv-avatar-group" aria-label={names.join(', ')}>
      {shown.map(function (n) { return <Avatar key={n} name={n} size={props.size || 'sm'} />; })}
      {rest > 0 ? <span className={'sv-avatar sv-avatar--' + (props.size || 'sm') + ' sv-avatar-group__more'}>+{rest}</span> : null}
    </span>
  );
}
