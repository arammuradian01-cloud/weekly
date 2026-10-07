import React from 'react';
import { Input } from './Input.jsx';
import { Icon } from '../core/Icon.jsx';

/* Поле пароля с кнопкой «Показать пароль» и подсказкой требований под полем.
   rules: показывать список требований (для «Придумайте пароль»); login, name: для проверки «без логина, имени и фамилии». */
export function checkPassword(value, login, name) {
  var v = value || '';
  var low = v.toLowerCase();
  var words = (String(name || '') + ' ' + String(login || '')).toLowerCase().split(/\s+/).filter(function (w) { return w.length >= 3; });
  return [
    { label: 'Не короче 10 символов', ok: v.length >= 10 },
    { label: 'Не только цифры', ok: v.length > 0 && !/^\d+$/.test(v) },
    { label: 'Без логина, имени и фамилии', ok: v.length > 0 && !words.some(function (w) { return low.indexOf(w) !== -1; }) }
  ];
}
export function PasswordInput(props) {
  var st = React.useState(false);
  var shown = st[0], setShown = st[1];
  var rules = props.rules ? checkPassword(props.value, props.login, props.name) : null;
  var touched = (props.value || '').length > 0;
  return (
    <div className="sv-field" style={{ gap: 6 }}>
      <Input {...props} type={shown ? 'text' : 'password'} autoComplete={props.autoComplete || 'current-password'}
        action={{ label: shown ? 'Скрыть' : 'Показать пароль', pressed: shown, onClick: function () { setShown(!shown); } }} />
      {rules ? (
        <ul className="sv-pw-rules" aria-live="polite">
          {rules.map(function (r) {
            return <li key={r.label} className={touched ? (r.ok ? 'is-ok' : 'is-bad') : ''}>
              <Icon name={touched ? (r.ok ? 'check' : 'x') : 'minus'} size={14} />{r.label}</li>;
          })}
        </ul>
      ) : null}
    </div>
  );
}
