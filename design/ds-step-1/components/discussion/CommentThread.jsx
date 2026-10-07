import React from 'react';
import { Avatar } from '../core/Avatar.jsx';
import { IconButton } from '../core/IconButton.jsx';
import { Button } from '../core/Button.jsx';
import { Textarea } from '../forms/Textarea.jsx';
import { Mention } from '../forms/MentionSuggest.jsx';
import { Reactions } from './Reactions.jsx';

/* Ветка комментариев с @упоминаниями, пометкой «изменено» и меню «Изменить», «Удалить» (свой комментарий правится 15 минут).
   comments: [{ id, author, time, text | parts: [string | { mention }], edited, mine, canEdit, deleted, reactions }].
   Поле ответа с подсказкой про @. */
export function renderParts(parts) {
  if (typeof parts === 'string') return parts;
  return (parts || []).map(function (p, i) { return typeof p === 'string' ? p : <Mention key={i}>{p.mention}</Mention>; });
}
export function Comment(props) {
  var c = props.comment;
  return (
    <div className={['sv-comment', c.mine ? 'sv-comment--mine' : '', c.deleted ? 'sv-comment--deleted' : ''].filter(Boolean).join(' ')}>
      <Avatar name={c.author} size="md" />
      <div style={{ minWidth: 0 }}>
        <div className="sv-comment__head">
          <span className="sv-comment__author">{c.author}</span>
          <span className="sv-comment__meta">{c.time}</span>
          {c.edited ? <span className="sv-comment__edited" title={'Изменён ' + c.edited}>изменено</span> : null}
          {(c.canEdit || c.canDelete) && !c.deleted ? <span className="sv-comment__menu"><IconButton icon="more-horizontal" label="Действия с комментарием" size="xs" onClick={function () { props.onMenu && props.onMenu(c); }} /></span> : null}
        </div>
        <p className="sv-comment__text">{c.deleted ? 'Комментарий удалён' : renderParts(c.parts || c.text)}</p>
        {!c.deleted && (c.reactions || props.onReact) ? <div className="sv-comment__foot"><Reactions compact value={c.reactions || {}} mine={c.myReaction} onReact={function (k) { props.onReact && props.onReact(c, k); }} /></div> : null}
      </div>
    </div>
  );
}
export function CommentThread(props) {
  return (
    <div className="sv-thread" style={props.style}>
      {(props.comments || []).map(function (c) { return <Comment key={c.id} comment={c} onMenu={props.onMenu} onReact={props.onReact} />; })}
      {props.readonly ? null : (
        <div className="sv-reply">
          <Avatar name={props.me || 'Арам Мурадян'} size="md" />
          <div className="sv-reply__box">
            <Textarea rows={2} placeholder={props.placeholder || 'Ответить, @имя позовёт коллегу'} value={props.draft} onChange={props.onDraft} />
            {props.children}
            <div className="sv-reply__actions"><span className="sv-reply__hint">Enter с ⌘ отправляет</span><Button variant="dark" size="sm" onClick={props.onSend} disabled={!props.draft}>Отправить</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
