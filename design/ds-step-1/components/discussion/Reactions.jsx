import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Avatar } from '../core/Avatar.jsx';

/* Реакции «Принято», «Вопрос», «Обсудить на встрече», «Спасибо». Повторное нажатие снимает свою.
   compact: строка со счётчиками для ленты; полная панель с именами (full): value: { accepted: ['Влад', ...], ... }.
   value в compact: { accepted: 3, question: 1 } или массивы имён. mine: ключ своей реакции. discussCount: число комментариев для кнопки «Обсудить». */
export var REACTIONS = [
  { key: 'accepted', label: 'Принято', icon: 'check' },
  { key: 'question', label: 'Вопрос', icon: 'help-circle' },
  { key: 'meeting', label: 'Обсудить на встрече', icon: 'presentation' },
  { key: 'thanks', label: 'Спасибо', icon: 'heart' }
];
function countOf(v) { return Array.isArray(v) ? v.length : (v || 0); }
export function Reactions(props) {
  var value = props.value || {};
  var size = props.size === 'lg' ? ' sv-reaction--lg' : '';
  if (props.full) {
    return (
      <div className="sv-reactions-full" style={props.style}>
        {REACTIONS.map(function (r) {
          var names = Array.isArray(value[r.key]) ? value[r.key] : [];
          var mine = props.mine === r.key;
          return (
            <div key={r.key} className="sv-reactions-full__row">
              <button type="button" className={'sv-reaction sv-reaction--lg' + (mine ? ' is-mine' : '')} aria-pressed={mine} onClick={function () { props.onReact && props.onReact(r.key); }} disabled={props.disabled}>
                <Icon name={r.icon} size={16} />{r.label}<span className="sv-reaction__count">{names.length || ''}</span>
              </button>
              <div className="sv-reactions-full__names">
                {names.length === 0 ? <span>Пока никто</span> : names.map(function (n) { return <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Avatar name={n} size="xs" />{n}</span>; })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="sv-reactions" role="group" aria-label="Реакции" style={props.style}>
      {REACTIONS.map(function (r) {
        var n = countOf(value[r.key]);
        var mine = props.mine === r.key;
        if (props.compact && n === 0 && !mine && !props.showAll) return null;
        return (
          <button type="button" key={r.key} className={'sv-reaction' + size + (mine ? ' is-mine' : '')} aria-pressed={mine} title={r.label} onClick={function () { props.onReact && props.onReact(r.key); }} disabled={props.disabled}>
            <Icon name={r.icon} size={14} />{props.compact && !props.labels ? null : r.label}{n ? <span className="sv-reaction__count">{n}</span> : null}
          </button>
        );
      })}
      {props.compact && !props.showAll ? <button type="button" className={'sv-reaction' + size} aria-label="Добавить реакцию" title="Добавить реакцию" onClick={props.onAdd}><Icon name="smile-plus" size={14} /></button> : null}
      {props.discussCount != null ? <button type="button" className={'sv-reaction sv-reaction--discuss' + size} onClick={props.onDiscuss} aria-expanded={props.discussOpen}><Icon name="message-square" size={14} />Обсудить{props.discussCount ? <span className="sv-reaction__count">{props.discussCount}</span> : null}</button> : null}
    </div>
  );
}
