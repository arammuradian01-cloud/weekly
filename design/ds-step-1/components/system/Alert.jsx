import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Плашка-предупреждение в потоке страницы. tone: info, warning, danger, success, neutral. Текст говорит, что случилось и что делать. */
export function Alert(props) {
  var tone = props.tone || 'info';
  var icon = props.icon || (tone === 'danger' ? 'alert-circle' : tone === 'warning' ? 'alert-triangle' : tone === 'success' ? 'check-circle-2' : 'info');
  return (
    <div className={'sv-alert sv-alert--' + tone} role={tone === 'danger' ? 'alert' : 'status'} style={props.style}>
      <Icon name={icon} size={18} />
      <div className="sv-alert__body">
        {props.title ? <div className="sv-alert__title">{props.title}</div> : null}
        <div>{props.children}</div>
        {props.actions ? <div className="sv-alert__actions">{props.actions}</div> : null}
      </div>
    </div>
  );
}
