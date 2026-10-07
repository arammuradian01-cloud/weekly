import React from 'react';

/* Аватар с инициалами на спокойном круге. Цвет выбирается по имени, фотографий нет.
   size: xs 20, sm 24, md 32, lg 40, xl 56. status: точка weekly (success, warning, danger, neutral, accent). vacancy: пустой пунктирный круг. */
export function initialsOf(name) {
  var parts = String(name || '').trim().split(/\s+/);
  var a = parts[0] ? parts[0].charAt(0) : '';
  var b = parts[1] ? parts[1].charAt(0) : '';
  return (a + b).toUpperCase().replace('.', '');
}
export function toneOf(name) {
  var s = 0;
  for (var i = 0; i < String(name).length; i++) s = (s * 31 + String(name).charCodeAt(i)) % 997;
  return (s % 8) + 1;
}
export function Avatar(props) {
  var size = props.size || 'md';
  var tone = props.tone || toneOf(props.name);
  var cls = ['sv-avatar', size !== 'md' ? 'sv-avatar--' + size : '', props.vacancy ? 'sv-avatar--vacancy' : 'sv-avatar--' + tone,
    props.round ? 'sv-avatar--round' : '', props.className || ''].filter(Boolean).join(' ');
  return (
    <span className={cls} title={props.name} aria-label={props.name} role="img" style={props.style}>
      {props.vacancy ? '' : initialsOf(props.name)}
      {props.status ? <span className={'sv-avatar__status sv-avatar__status--' + props.status} /> : null}
    </span>
  );
}
