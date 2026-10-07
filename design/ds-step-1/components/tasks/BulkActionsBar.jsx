import React from 'react';
import { Button } from '../core/Button.jsx';
import { IconButton } from '../core/IconButton.jsx';

/* Панель массовых действий при выборе строк: залипает снизу. actions: [{ key, label, icon, danger }]. */
export function BulkActionsBar(props) {
  var actions = props.actions || [{ key: 'status', label: 'Сменить статус', icon: 'circle-dot' }, { key: 'owner', label: 'Передать', icon: 'user-round' }, { key: 'due', label: 'Перенести срок', icon: 'calendar' }, { key: 'archive', label: 'В архив', icon: 'archive' }];
  var n = props.count || 0;
  var word = n % 10 === 1 && n % 100 !== 11 ? 'задача' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'задачи' : 'задач';
  return (
    <div className="sv-bulk" role="toolbar" aria-label="Действия с выбранными" style={props.style}>
      <span className="sv-bulk__count">{n + ' ' + word}</span>
      {actions.map(function (a) { return <Button key={a.key} size="sm" variant="outline" icon={a.icon} onClick={function () { props.onAction && props.onAction(a.key); }}>{a.label}</Button>; })}
      <IconButton icon="x" label="Снять выбор" size="sm" onClick={props.onClear} />
    </div>
  );
}
