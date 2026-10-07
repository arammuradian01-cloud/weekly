import React from 'react';

/* Мини-график в карточке лидера: линия по последним неделям, текущее значение и изменение. values: числа; trend: up | down | flat (цвет линии). */
export function Sparkline(props) {
  var v = props.values || [];
  var W = props.width || 80, H = props.height || 24;
  var max = Math.max.apply(null, v.concat([1])), min = Math.min.apply(null, v.concat([0]));
  var span = max - min || 1;
  var pts = v.map(function (x, i) { return [(i / Math.max(v.length - 1, 1)) * W, H - ((x - min) / span) * H]; });
  var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  var delta = v.length > 1 ? v[v.length - 1] - v[v.length - 2] : 0;
  var trend = props.trend || (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat');
  var good = props.lowerIsBetter ? (trend === 'down' ? 'up' : trend === 'up' ? 'down' : 'flat') : trend;
  return (
    <span className="sv-sparkline" style={props.style} role="img" aria-label={props.label}>
      <svg width={W} height={H} viewBox={'0 0 ' + W + ' ' + H}><path className={'sv-sparkline__line' + (good !== 'flat' ? ' sv-sparkline__line--' + good : '')} d={d} /></svg>
      {props.showValue !== false ? <span className="sv-sparkline__value">{v[v.length - 1]}{props.unit || ''}</span> : null}
      {props.showDelta && delta !== 0 ? <span className={'sv-sparkline__delta sv-sparkline__delta--' + good}>{(delta > 0 ? '+' : '') + delta}{props.unit || ''}</span> : null}
    </span>
  );
}
