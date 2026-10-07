import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { Checkbox } from '../forms/Checkbox.jsx';
import { StatusBadge } from '../core/StatusBadge.jsx';
import { PriorityMark } from '../core/PriorityMark.jsx';
import { StateDot } from '../core/StateDot.jsx';
import { OverdueLabel } from '../core/OverdueLabel.jsx';
import { CounterBadge } from '../core/CounterBadge.jsx';

/* Таблица задач. Колонки: №, задача и «где сейчас», ответственный, приоритет, статус, состояние, срок.
   rows: [{ id, title, now, owner, priority, status, state, outside, due, overdueDays, soon, selected, closed, group, blocked }].
   groupBy: поле группировки (owner и др.), строки должны быть уже отсортированы. selectable: чекбоксы. onEdit(row, field): правка статуса и состояния в строке.
   loading: число скелетонных строк. dense: строка 44 (по умолчанию) или comfortable 52. */
export function InlineEdit(props) {
  return (
    <button type="button" className={'sv-inline-edit' + (props.open ? ' is-open' : '')} onClick={function (e) { e.stopPropagation(); props.onClick && props.onClick(e); }} aria-haspopup="listbox" aria-label={props.label}>
      {props.children}<Icon name="chevron-down" size={14} className="sv-inline-edit__chev" />
    </button>
  );
}
export function TaskTable(props) {
  var rows = props.rows || [];
  var cols = props.columns || ['id', 'task', 'owner', 'priority', 'status', 'state', 'due'];
  var selected = props.selected || [];
  var allSel = rows.length > 0 && rows.every(function (r) { return selected.indexOf(r.id) !== -1; });
  var someSel = !allSel && rows.some(function (r) { return selected.indexOf(r.id) !== -1; });
  var head = { id: '№', task: 'Задача', owner: 'Ответственный', team: 'Команда', priority: 'Приоритет', status: 'Статус', state: 'Состояние', due: 'Срок', updated: 'Обновлена' };
  function toggle(id) { if (!props.onSelect) return; props.onSelect(selected.indexOf(id) !== -1 ? selected.filter(function (x) { return x !== id; }) : selected.concat([id])); }
  var lastGroup = null;
  var body = [];
  if (props.loading) {
    for (var i = 0; i < props.loading; i++) {
      body.push(<tr key={'sk' + i} aria-hidden="true">{props.selectable ? <td className="is-check" /> : null}{cols.map(function (c) {
        return <td key={c}>{c === 'task' ? <div className="sv-task" style={{ gap: 6 }}><span className="sv-skeleton" style={{ width: 180 + (i % 3) * 60 }} /><span className="sv-skeleton" style={{ width: 120, height: 8 }} /></div>
          : c === 'owner' ? <span className="sv-cell-person"><span className="sv-skeleton sv-skeleton--circle" style={{ width: 24, height: 24 }} /><span className="sv-skeleton" style={{ width: 60 }} /></span>
          : <span className="sv-skeleton" style={{ width: c === 'id' ? 28 : 72 }} />}</td>; })}</tr>);
    }
  }
  rows.forEach(function (r) {
    if (props.groupBy && r[props.groupBy] !== lastGroup) {
      lastGroup = r[props.groupBy];
      var n = rows.filter(function (x) { return x[props.groupBy] === lastGroup; }).length;
      body.push(<tr key={'g' + lastGroup} className="sv-table__group"><td colSpan={cols.length + (props.selectable ? 1 : 0)}>{lastGroup}<CounterBadge value={n} tone="neutral" /></td></tr>);
    }
    var isSel = selected.indexOf(r.id) !== -1;
    var cls = [isSel ? 'is-selected' : '', r.overdueDays > 0 && !r.closed ? 'is-overdue' : '', r.closed ? 'is-closed' : '', r.outside ? 'is-outside' : '', r.focused ? 'is-focused' : ''].filter(Boolean).join(' ');
    body.push(
      <tr key={r.id} className={cls} tabIndex={0} aria-selected={isSel} onClick={function () { props.onOpen && props.onOpen(r); }} onKeyDown={function (e) { if (e.key === 'Enter') props.onOpen && props.onOpen(r); }}>
        {props.selectable ? <td className="is-check" onClick={function (e) { e.stopPropagation(); }}><Checkbox checked={isSel} onChange={function () { toggle(r.id); }} ariaLabel={'Выбрать задачу ' + r.id} /></td> : null}
        {cols.map(function (c) {
          if (c === 'id') return <td key={c} className="is-id">{r.id}</td>;
          if (c === 'task') return <td key={c} style={{ whiteSpace: 'normal' }}><div className="sv-task">
            <span className="sv-task__title">{r.blocked ? <Icon name="octagon-alert" size={14} label="Заблокирована" /> : null}{r.title}</span>
            <span className={'sv-task__now' + (r.now ? '' : ' sv-task__now--empty')}>{r.now || 'Где сейчас: не заполнено'}</span></div></td>;
          if (c === 'owner') return <td key={c}><span className="sv-cell-person"><Avatar name={r.owner} size="sm" />{r.owner}</span></td>;
          if (c === 'team') return <td key={c} style={{ color: 'var(--color-text-secondary)' }}>{r.team}</td>;
          if (c === 'priority') return <td key={c}><PriorityMark level={r.priority} /></td>;
          if (c === 'status') return <td key={c}>{props.onEdit ? <InlineEdit label="Сменить статус" open={r.editing === 'status'} onClick={function () { props.onEdit(r, 'status'); }}><StatusBadge task={r.status} /></InlineEdit> : <StatusBadge task={r.status} />}</td>;
          if (c === 'state') return <td key={c}>{props.onEdit ? <InlineEdit label="Сменить состояние" onClick={function () { props.onEdit(r, 'state'); }}><StateDot state={r.state} outside={r.outside} /></InlineEdit> : <StateDot state={r.state} outside={r.outside} />}</td>;
          if (c === 'due') return <td key={c}><OverdueLabel date={r.due} days={r.closed ? 0 : r.overdueDays} soon={r.soon} /></td>;
          if (c === 'updated') return <td key={c} style={{ color: 'var(--color-text-secondary)' }}>{r.updated}</td>;
          return <td key={c}>{r[c]}</td>;
        })}
      </tr>
    );
  });
  return (
    <div className={'sv-table-wrap' + (props.className ? ' ' + props.className : '')} style={props.style}>
      <table className={'sv-table' + (props.dense === 'comfortable' ? ' sv-table--comfortable' : '')}>
        <thead><tr>
          {props.selectable ? <th className="is-check"><Checkbox checked={allSel} indeterminate={someSel} onChange={function () { props.onSelect && props.onSelect(allSel ? [] : rows.map(function (r) { return r.id; })); }} ariaLabel="Выбрать все" /></th> : null}
          {cols.map(function (c) {
            var sorted = props.sort && props.sort.by === c;
            return <th key={c} className={[props.onSort ? 'is-sortable' : '', sorted ? 'is-sorted' : ''].filter(Boolean).join(' ')} aria-sort={sorted ? (props.sort.dir === 'desc' ? 'descending' : 'ascending') : undefined} onClick={function () { props.onSort && props.onSort(c); }}>
              {head[c] || c}{props.onSort ? <Icon name={sorted ? (props.sort.dir === 'desc' ? 'arrow-down' : 'arrow-up') : 'chevrons-up-down'} size={14} /> : null}</th>;
          })}
        </tr></thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}
