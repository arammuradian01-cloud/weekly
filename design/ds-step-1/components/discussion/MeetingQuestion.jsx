import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Button } from '../core/Button.jsx';
import { Textarea } from '../forms/Textarea.jsx';
import { FormField } from '../forms/FormField.jsx';

/* «Обсудить на встрече»: форма с вопросом одной фразой (MeetingQuestionForm) и пометка «Вопрос к встрече» с кнопкой «Обсуждено» (MeetingQuestion).
   question: { text, author, about, time, done, doneBy, canClose }. */
export function MeetingQuestionForm(props) {
  var st = React.useState(props.value || '');
  return (
    <div className="sv-mq-form" style={props.style}>
      <FormField label="Вопрос к встрече" hint="Одна фраза: что нужно решить" max={150} count={st[0].length}>
        <Textarea rows={2} value={st[0]} onChange={function (e) { st[1](e.target.value); }} placeholder="Например: нужен ли нам отдельный тариф для такси" />
      </FormField>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="text" size="sm" onClick={props.onCancel}>Отменить</Button>
        <Button variant="dark" size="sm" disabled={!st[0]} onClick={function () { props.onSubmit && props.onSubmit(st[0]); }}>В повестку</Button>
      </div>
    </div>
  );
}
export function MeetingQuestion(props) {
  var q = props.question || {};
  return (
    <div className={'sv-mq' + (q.done ? ' sv-mq--done' : '')} style={props.style}>
      <div className="sv-mq__head"><Icon name="presentation" size={16} />{q.done ? 'Обсуждено' : 'Вопрос к встрече'}{q.done && q.doneBy ? <span className="sv-mq__meta">, отметил {q.doneBy}</span> : null}</div>
      <p className="sv-mq__text">{q.text}</p>
      <div className="sv-mq__meta">{q.author}{q.about ? ', о работе: ' + q.about : ''}{q.time ? ', ' + q.time : ''}</div>
      {!q.done && q.canClose ? <div className="sv-mq__actions"><Button size="sm" variant="outline" icon="check" onClick={props.onDone}>Обсуждено</Button>{props.link ? <Button size="sm" variant="text" iconRight="arrow-up-right" href={props.link}>К записи</Button> : null}</div> : null}
    </div>
  );
}
