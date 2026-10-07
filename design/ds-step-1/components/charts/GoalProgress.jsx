import React from 'react';

/* Полоса прогресса цели: база, текущее, целевое; отметка плана. tone: ok, risk, fail или по умолчанию акцент. Значения метрик живут в борде, здесь только показ. */
export function GoalProgress(props) {
  var base = props.base || 0, target = props.target || 100, value = props.value || 0;
  var pct = Math.max(0, Math.min(100, Math.round((value - base) / ((target - base) || 1) * 100)));
  return (
    <div className={'sv-goal-progress' + (props.tone ? ' sv-goal-progress--' + props.tone : '')} style={props.style}>
      <div className="sv-goal-progress__head"><span>{props.label}</span><span><b>{value}{props.unit || ''}</b> из {target}{props.unit || ''}, {pct}%</span></div>
      <div className="sv-goal-progress__track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={props.label}>
        <div className="sv-goal-progress__fill" style={{ width: pct + '%' }} />
        {props.plan != null ? <span className="sv-goal-progress__plan" style={{ left: Math.max(0, Math.min(100, Math.round((props.plan - base) / ((target - base) || 1) * 100))) + '%' }} title={'План на сегодня: ' + props.plan + (props.unit || '')} /> : null}
      </div>
      {props.tasksDone != null ? <div className="sv-goal-progress__foot"><span>закрыто {props.tasksDone} из {props.tasksTotal} задач</span>{props.updated ? <span>обновлено {props.updated}</span> : null}</div> : null}
    </div>
  );
}
