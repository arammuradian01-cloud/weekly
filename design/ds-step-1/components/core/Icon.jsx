import React from 'react';

/* Линейная иконка из набора Lucide: обводка 1,5 px на сетке 20, скруглённые концы, один цвет (currentColor).
   Требует window.lucide (UMD-сборка lucide). Имя в kebab-case, как в Lucide: "check", "bell", "calendar". */
function pascal(name) {
  return String(name).split('-').map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); }).join('');
}
export function Icon(props) {
  var name = props.name, size = props.size || 20, strokeWidth = props.strokeWidth || 1.5;
  var ref = React.useRef(null);
  React.useEffect(function () {
    var el = ref.current;
    if (!el) return;
    el.innerHTML = '';
    var L = window.lucide;
    if (!L) return;
    var def = (L.icons && (L.icons[pascal(name)] || L.icons[name])) || L[pascal(name)];
    if (!def || !L.createElement) return;
    var svg = L.createElement(def);
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('stroke-width', strokeWidth);
    svg.setAttribute('aria-hidden', 'true');
    el.appendChild(svg);
  }, [name, size, strokeWidth]);
  var cls = 'sv-icon' + (props.tone ? ' sv-icon--' + props.tone : '') + (props.className ? ' ' + props.className : '');
  return (
    <span ref={ref} className={cls} role={props.label ? 'img' : undefined} aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
      style={Object.assign({ width: size, height: size }, props.style)} />
  );
}

/* Иконка на тонированном круге, как на сайте: для типов событий в «Мне» и пустых состояний. */
export function IconCircle(props) {
  var size = props.size || 40;
  return (
    <span className={'sv-icon-circle sv-icon-circle--' + (props.tone || 'accent')} style={{ width: size, height: size }}>
      <Icon name={props.name} size={props.iconSize || Math.round(size / 2)} />
    </span>
  );
}
