import React from 'react';
import { IconCircle } from '../core/Icon.jsx';
import { Icon } from '../core/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';
import { Button } from '../core/Button.jsx';

/* Строка события в «Мне»: иконка типа на тонированном круге, фраза кто и что, предмет, время, действия «Разобрано» и «Напомнить».
   type: task, comment, mention, entryComment, reaction, meetingQuestion, request, updateRequest.
   event: { id, type, who, what, subject, subjectIcon, time, unread, done, request: { onAccept, onDecline } }. */
export var EVENT_TYPES = {
  task: { icon: 'check-square', tone: 'accent' },
  comment: { icon: 'message-square', tone: 'info' },
  mention: { icon: 'at-sign', tone: 'accent' },
  entryComment: { icon: 'message-square-text', tone: 'info' },
  reaction: { icon: 'heart', tone: 'success' },
  meetingQuestion: { icon: 'presentation', tone: 'warning' },
  request: { icon: 'hand', tone: 'info' },
  updateRequest: { icon: 'refresh-cw', tone: 'warning' },
  deadline: { icon: 'clock', tone: 'danger' }
};
export function EventRow(props) {
  var e = props.event;
  var t = EVENT_TYPES[e.type] || EVENT_TYPES.task;
  return (
    <div className={['sv-event', e.unread ? 'is-unread' : '', e.done ? 'is-done' : '', e.type === 'request' ? 'is-request' : ''].filter(Boolean).join(' ')} tabIndex={0}>
      <IconCircle name={t.icon} tone={t.tone} size={40} iconSize={20} />
      <div style={{ minWidth: 0 }}>
        <p className="sv-event__text"><b>{e.who}</b> {e.what}</p>
        {e.subject ? <a className="sv-event__subject" href={e.href || '#'}><Icon name={e.subjectIcon || 'check-square'} size={14} /><span>{e.subject}</span></a> : null}
        {e.type === 'request' && !e.done ? <div className="sv-event__request-actions"><Button size="sm" variant="primary" onClick={props.onAccept}>Принять</Button><Button size="sm" variant="outline" onClick={props.onDecline}>Отклонить</Button></div> : null}
      </div>
      <div className="sv-event__side">
        <span className="sv-event__time">{e.time}</span>
        {e.done ? null : <div className="sv-event__actions">
          <IconButton icon="alarm-clock" label="Напомнить: завтра в 9:00 или в понедельник" size="sm" onClick={function () { props.onRemind && props.onRemind(e); }} />
          <IconButton icon="check" label="Разобрано" size="sm" onClick={function () { props.onDone && props.onDone(e); }} />
        </div>}
      </div>
    </div>
  );
}
export function EventList(props) {
  var groups = [];
  (props.events || []).forEach(function (e) {
    var g = groups.filter(function (x) { return x.name === e.group; })[0];
    if (!g) { g = { name: e.group, items: [] }; groups.push(g); }
    g.items.push(e);
  });
  return (
    <div className="sv-event-list" style={props.style}>
      {groups.map(function (g) { return <div key={g.name || 'x'}>{g.name ? <div className="sv-event-group">{g.name}</div> : null}{g.items.map(function (e) { return <EventRow key={e.id} event={e} onDone={props.onDone} onRemind={props.onRemind} onAccept={props.onAccept} onDecline={props.onDecline} />; })}</div>; })}
    </div>
  );
}
