import React from 'react';
import { Select } from './Select.jsx';
import { Avatar } from '../core/Avatar.jsx';

/* Выбор человека: список с аватаром, именем и должностью, поиск внутри. people: [{ id, name, role, disabled }]. */
export function PersonPicker(props) {
  var options = (props.people || []).map(function (p) {
    return { value: p.id, label: p.name, sub: p.role, disabled: p.disabled, avatar: <Avatar name={p.name} size="sm" /> };
  });
  return <Select {...props} options={options} searchable searchPlaceholder="Имя или должность" placeholder={props.placeholder || 'Кому'} icon={props.value ? undefined : 'user'} />;
}
