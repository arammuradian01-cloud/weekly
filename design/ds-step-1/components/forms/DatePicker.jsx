import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Button } from '../core/Button.jsx';
import { IconButton } from '../core/IconButton.jsx';

/* Выбор даты с быстрыми вариантами: завтра, пятница, через неделю. value: Date или null. open: открыт для макета.
   marked: даты с отметкой (срок weekly, встреча). */
var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
var MONTHS_N = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
var WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
export function formatDate(d) {
  if (!d) return '';
  return WD[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}
function sameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
export function DatePicker(props) {
  var today = props.today || new Date(2026, 9, 7);
  var st = React.useState(!!props.open);
  var open = st[0], setOpen = st[1];
  var vs = React.useState(new Date((props.value || today).getFullYear(), (props.value || today).getMonth(), 1));
  var view = vs[0], setView = vs[1];
  var size = props.size || 'md';
  function pick(d) { props.onChange && props.onChange(d); if (!props.open) setOpen(false); }
  var friday = addDays(today, ((5 - today.getDay()) + 7) % 7 || 7);
  var quick = [{ label: 'Завтра', d: addDays(today, 1) }, { label: 'Пятница', d: friday }, { label: 'Через неделю', d: addDays(today, 7) }];
  var first = new Date(view.getFullYear(), view.getMonth(), 1);
  var start = addDays(first, -((first.getDay() + 6) % 7));
  var cells = [];
  for (var i = 0; i < 42; i++) cells.push(addDays(start, i));
  var marked = props.marked || [];
  return (
    <div className="sv-select" style={props.style}>
      <button type="button" className={['sv-input', 'sv-select__trigger', size !== 'md' ? 'sv-input--' + size : '', open ? 'is-focused' : '', props.error ? 'is-error' : '', props.disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}
        aria-haspopup="dialog" aria-expanded={open} disabled={props.disabled} onClick={function () { setOpen(!open); }}>
        <Icon name="calendar" size={18} />
        <span className={'sv-select__value' + (props.value ? '' : ' sv-select__value--placeholder')}>{props.value ? formatDate(props.value) : (props.placeholder || 'Срок')}</span>
        {props.value && props.onChange && !props.required ? <span className="sv-input__btn" role="button" onClick={function (e) { e.stopPropagation(); props.onChange(null); }}>Убрать</span> : null}
      </button>
      {open ? (
        <div className={'sv-menu sv-date' + (props.staticMenu ? ' sv-menu--static' : '')} role="dialog" aria-label="Выбор даты" style={{ padding: 0, width: 292 }}>
          <div className="sv-date__quick">
            {quick.map(function (qk) { return <Button key={qk.label} size="sm" variant={sameDay(props.value, qk.d) ? 'secondary' : 'outline'} onClick={function () { pick(qk.d); }}>{qk.label}</Button>; })}
          </div>
          <div className="sv-cal">
            <div className="sv-cal__head">
              <IconButton size="sm" icon="chevron-left" label="Прошлый месяц" onClick={function () { setView(new Date(view.getFullYear(), view.getMonth() - 1, 1)); }} />
              <span className="sv-cal__title">{MONTHS_N[view.getMonth()] + ' ' + view.getFullYear()}</span>
              <IconButton size="sm" icon="chevron-right" label="Следующий месяц" onClick={function () { setView(new Date(view.getFullYear(), view.getMonth() + 1, 1)); }} />
            </div>
            <div className="sv-cal__grid">
              {WD.map(function (w, i) { return <span key={w} className={'sv-cal__wd' + (i > 4 ? ' sv-cal__wd--we' : '')}>{w}</span>; })}
              {cells.map(function (d) {
                var cls = ['sv-cal__day', d.getMonth() !== view.getMonth() ? 'is-muted' : '', sameDay(d, today) ? 'is-today' : '', sameDay(d, props.value) ? 'is-selected' : '',
                  marked.some(function (m) { return sameDay(m, d); }) ? 'is-marked' : ''].filter(Boolean).join(' ');
                return <button type="button" key={d.toISOString()} className={cls} onClick={function () { pick(d); }} aria-label={formatDate(d)}>{d.getDate()}</button>;
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
