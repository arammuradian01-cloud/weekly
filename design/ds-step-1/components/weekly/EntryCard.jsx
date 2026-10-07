import React from 'react';
import { Tag } from '../core/Tag.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { Icon } from '../core/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';
import { Button } from '../core/Button.jsx';
import { Reactions } from '../discussion/Reactions.jsx';
import { UpBadge } from './UpBadge.jsx';

/* Карточка записи weekly. entry: { type: result | event | risk | plan, block, direction, what, details, impact, fact, next, links: [{ label, href }], help: { to, due }, thanks: { to, for }, ceo, up, author, questionOpen }.
   collapsed: только тип и первая фраза. Под записью компактная строка реакций и «Обсудить». canUp: кнопка «Наверх» для руководителя. manager: видит флажок CEO. */
export function EntryCard(props) {
  var e = props.entry || {};
  if (props.collapsed) {
    return (
      <article className="sv-entry sv-entry--collapsed" onClick={props.onExpand} tabIndex={0}>
        <Tag kind={e.type} /><h3 className="sv-entry__title sv-entry__title--body">{e.what}</h3>
        {e.up ? <UpBadge /> : null}{e.ceo && props.manager ? <Tag kind="ceo" /> : null}<Icon name="chevron-down" size={18} className="sv-icon--muted" />
      </article>
    );
  }
  return (
    <article className={'sv-entry' + (e.up ? ' sv-entry--up' : '')} style={props.style}>
      <div className="sv-entry__head">
        <Tag kind={e.type} />{e.direction ? <span className="sv-entry__dir">{e.direction}</span> : null}{e.block ? <span className="sv-entry__dir">{e.block}</span> : null}
        {e.help ? <Tag kind="help" /> : null}{e.ceo && props.manager ? <Tag kind="ceo" /> : null}{e.up ? <UpBadge by={e.upBy} /> : null}{e.questionOpen ? <Tag kind="question" /> : null}
        <div className="sv-entry__actions">
          {props.canUp && !e.up ? <Button size="sm" variant="text" icon="arrow-up" onClick={props.onUp}>Наверх</Button> : null}
          {props.onMenu ? <IconButton icon="more-horizontal" label="Действия с записью" size="sm" onClick={props.onMenu} /> : null}
        </div>
      </div>
      <h3 className="sv-entry__title">{e.what}</h3>
      {e.details ? <div className="sv-entry__block"><span className="sv-entry__label">Подробнее</span><p className="sv-entry__text">{e.details}</p></div> : null}
      {e.impact ? <div className="sv-entry__block"><span className="sv-entry__label">Влияние на бизнес</span><p className="sv-entry__text">{e.impact}</p></div> : null}
      {e.fact ? <div className="sv-entry__block"><span className="sv-entry__label">Цифра или факт</span><p className="sv-entry__text">{e.fact}</p></div> : null}
      {e.next ? <div className="sv-entry__block"><span className="sv-entry__label">Что делаем дальше</span><p className="sv-entry__text">{e.next}</p></div> : null}
      {e.help ? <div className="sv-entry__block"><span className="sv-entry__label">Нужна помощь</span><p className="sv-entry__text">{e.help.to}{e.help.due ? ', до ' + e.help.due : ''}{e.help.what ? ': ' + e.help.what : ''}</p></div> : null}
      {e.thanks ? <div className="sv-entry__thanks"><Icon name="heart" size={16} />Спасибо <b>{e.thanks.to}</b> за {e.thanks.for}</div> : null}
      {e.links && e.links.length ? <div className="sv-entry__links">{e.links.map(function (l, i) { return <a key={i} href={l.href || '#'}><Icon name="link" size={12} style={{ verticalAlign: -1, marginRight: 4 }} />{l.label}</a>; })}</div> : null}
      {props.reactions !== null ? (
        <div className="sv-entry__foot">
          <Reactions compact value={props.reactions || {}} mine={props.myReaction} discussCount={props.comments || 0} onReact={props.onReact} onDiscuss={props.onDiscuss} />
          {e.author ? <span className="sv-entry__author"><Avatar name={e.author} size="xs" />{e.author}</span> : null}
        </div>
      ) : null}
      {props.children}
    </article>
  );
}
