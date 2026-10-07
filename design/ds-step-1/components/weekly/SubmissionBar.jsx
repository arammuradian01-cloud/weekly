import React from 'react';
import { Avatar } from '../core/Avatar.jsx';

/* Полоса сдачи «кто сдал»: сдали 7 из 8, аватары со статусами. people: [{ name, status: submitted | draft | none | late | vacation }]. */
var DOT = { submitted: 'success', late: 'warning', draft: 'accent', none: 'neutral', vacation: 'neutral' };
var TITLE = { submitted: 'Сдан', late: 'Сдан с опозданием', draft: 'Черновик', none: 'Не начат', vacation: 'В отпуске' };
export function SubmissionBar(props) {
  var people = props.people || [];
  var done = people.filter(function (p) { return p.status === 'submitted' || p.status === 'late'; }).length;
  var total = people.filter(function (p) { return p.status !== 'vacation'; }).length;
  return (
    <div className="sv-submit-bar" style={props.style}>
      <span className="sv-submit-bar__text">Сдали {done} из {total}{props.deadline ? <span>, срок {props.deadline}</span> : null}</span>
      <div className="sv-submit-bar__track" aria-hidden="true"><div className="sv-submit-bar__fill" style={{ width: (total ? Math.round(done / total * 100) : 0) + '%' }} /></div>
      <div className="sv-submit-bar__people">
        {people.map(function (p) { return <span key={p.name} className={'sv-submit-bar__person' + (p.status === 'none' || p.status === 'vacation' ? ' is-pending' : '')} title={p.name + ': ' + TITLE[p.status]}><Avatar name={p.name} size={props.size || 'md'} status={DOT[p.status]} /></span>; })}
      </div>
    </div>
  );
}
