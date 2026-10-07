import React from 'react';
import { StatusBadge } from '../core/StatusBadge.jsx';

/* Таблица «Команда»: человек и роль слева, цифры справа, статус weekly за неделю, итог «Вся команда».
   rows: [{ id, name, role, you, total, inWork, overdue, risk, closed, stale, weekly: 'none'|'draft'|'done'|'late' }]. week: номер недели. onPick(row): имя открывает разбор. */
function Num(props) { var v = props.v || 0; return <td className={props.cls || ''}><span className={(props.bad && v > 0) ? 'is-bad' : v === 0 ? 'is-zero' : ''}>{v}</span></td>; }
export function TeamTable(props) {
  var rows = props.rows || [];
  var sum = function (k) { return rows.reduce(function (a, r) { return a + (r[k] || 0); }, 0); };
  function Cell(p) { var v = p.v || 0; return <div className="sv-team-card__cell"><span>{p.label}</span><span className={p.bad && v > 0 ? 'is-bad' : ''}>{v}</span></div>; }
  return (
    <div style={props.style}>
    <div className="sv-team-cards" role="list">
      {rows.map(function (r) {
        return (
          <div className="sv-team-card" key={'c' + (r.id || r.name)} role="listitem">
            <div className="sv-team-card__head"><div><a className="sv-team-table__name" href={'#person-' + (r.id || '')} onClick={function (e) { if (props.onPick) { e.preventDefault(); props.onPick(r); } }}>{r.name}</a><div className="sv-team-table__role">{r.role}</div></div><StatusBadge weekly={r.weekly || 'none'} /></div>
            <div className="sv-team-card__grid"><Cell label="В работе" v={r.inWork} /><Cell label="Просрочено" v={r.overdue} bad /><Cell label="С риском" v={r.risk} bad /><Cell label="Закрыто" v={r.closed} /><Cell label="Без обновлений" v={r.stale} bad /><Cell label="Всего" v={r.total} /></div>
          </div>
        );
      })}
    </div>
    <div className="sv-team-table__wrap">
      <table className="sv-team-table">
        <thead><tr><th>Человек</th><th>Всего</th><th>В работе</th><th>Просрочено</th><th className="col-opt">С риском</th><th className="col-opt">Закрыто за неделю</th><th className="col-tablet">Давно не обновлялись</th><th>Weekly{props.week ? ' за неделю ' + props.week : ''}</th></tr></thead>
        <tbody>
          {rows.map(function (r) {
            return (
              <tr key={r.id || r.name}>
                <td><a className="sv-team-table__name" href={'#person-' + (r.id || '')} onClick={function (e) { if (props.onPick) { e.preventDefault(); props.onPick(r); } }}>{r.name}{r.you ? <span className="sv-team-table__you">это вы</span> : null}</a><div className="sv-team-table__role">{r.role}</div></td>
                <Num v={r.total} /><Num v={r.inWork} /><Num v={r.overdue} bad /><Num v={r.risk} bad cls="col-opt" /><Num v={r.closed} cls="col-opt" /><Num v={r.stale} bad cls="col-tablet" />
                <td><StatusBadge weekly={r.weekly || 'none'} /></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td>Вся команда</td><td>{sum('total')}</td><td>{sum('inWork')}</td><td><span className={sum('overdue') ? 'is-bad' : ''}>{sum('overdue')}</span></td><td className="col-opt">{sum('risk')}</td><td className="col-opt">{sum('closed')}</td><td className="col-tablet">{sum('stale')}</td><td></td></tr></tfoot>
      </table>
    </div>
    </div>
  );
}
