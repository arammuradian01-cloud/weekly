import React from 'react';

/* Столбики и линия по неделям. data: [{ label, bar, line, current }]. insight: одна фраза с выводом. barLabel, lineLabel: легенда. max: верх шкалы. */
export function BarLineChart(props) {
  var data = props.data || [];
  var W = 560, H = 160, padL = 28, padB = 22, padT = 14;
  var max = props.max || Math.max.apply(null, data.map(function (d) { return Math.max(d.bar || 0, d.line || 0); }).concat([1]));
  var n = data.length || 1;
  var slot = (W - padL) / n;
  var bw = Math.min(28, slot * 0.5);
  var y = function (v) { return padT + (H - padT - padB) * (1 - v / max); };
  var pts = data.map(function (d, i) { return d.line == null ? null : [padL + slot * i + slot / 2, y(d.line)]; }).filter(Boolean);
  var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  var ticks = [0, 0.5, 1];
  return (
    <figure className="sv-chart" style={Object.assign({ margin: 0 }, props.style)}>
      {props.title ? <figcaption className="sv-chart__title">{props.title}</figcaption> : null}
      <svg viewBox={'0 0 ' + W + ' ' + H} role="img" aria-label={props.title}>
        {ticks.map(function (t) { return <g key={t}><line className="sv-chart__grid" x1={padL} x2={W} y1={y(max * t)} y2={y(max * t)} /><text className="sv-chart__axis" x={0} y={y(max * t) + 4}>{Math.round(max * t)}{props.unit || ''}</text></g>; })}
        {data.map(function (d, i) {
          var x = padL + slot * i + slot / 2;
          return <g key={i}>
            {d.bar != null ? <rect className={'sv-chart__bar' + (d.current ? ' sv-chart__bar--current' : d.muted ? ' sv-chart__bar--muted' : '')} x={x - bw / 2} y={y(d.bar)} width={bw} height={Math.max(0, H - padB - y(d.bar))} rx={3} /> : null}
            {props.showValues && d.bar != null ? <text className="sv-chart__value" x={x} y={y(d.bar) - 4} textAnchor="middle">{d.bar}{props.unit || ''}</text> : null}
            <text className="sv-chart__axis" x={x} y={H - 6} textAnchor="middle">{d.label}</text>
          </g>;
        })}
        {pts.length ? <path className="sv-chart__line" d={path} /> : null}
        {pts.map(function (p, i) { return <circle key={i} className="sv-chart__dot" cx={p[0]} cy={p[1]} r={3.5} />; })}
      </svg>
      {(props.barLabel || props.lineLabel) ? <div className="sv-chart__legend">{props.barLabel ? <span><i style={{ background: 'var(--color-chart-1)' }} />{props.barLabel}</span> : null}{props.lineLabel ? <span><i style={{ background: 'var(--color-chart-2)', borderRadius: 5, height: 3 }} />{props.lineLabel}</span> : null}</div> : null}
      {props.insight ? <p className="sv-chart__insight">{props.insight}</p> : null}
    </figure>
  );
}
