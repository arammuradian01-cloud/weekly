import React from 'react';

/* Официальный логотип Сравни из брендбука (assets/logo). variant: color (знак цветной, слово тёмно-синее, для светлых поверхностей),
   white (знак цветной, слово белое, для тёмного меню), mono (весь #002A3A), monoWhite (весь белый). lang: rus | eng. sign: только знак (обрезка через object-fit).
   Не перерисовываем и не стилизуем. */
export function assetsRoot() {
  var l = document.querySelector('link[href$="styles.css"]');
  var href = l ? l.getAttribute('href') : 'styles.css';
  return href.replace(/styles\.css$/, '');
}
export function Logo(props) {
  var v = props.variant || 'color';
  var suffix = v === 'white' ? '_w' : v === 'mono' ? '_m' : v === 'monoWhite' ? '_mw' : '';
  var file = 'sravni_logo_' + (props.lang || 'rus') + suffix + '.svg';
  var h = props.height || 28;
  if (props.sign) {
    /* Знак в файле занимает x 60-262 из 1007, y 90-242 из 328: показываем только этот фрагмент */
    var scale = h / 152;
    return <span className="sv-logo sv-logo--sign" style={Object.assign({ width: Math.round(202 * scale), height: h }, props.style)} role="img" aria-label="Сравни"><img src={assetsRoot() + 'assets/logo/' + file} alt="" style={{ width: Math.round(1007 * scale), height: Math.round(328 * scale), marginLeft: -Math.round(60 * scale), marginTop: -Math.round(90 * scale) }} /></span>;
  }
  return <img className="sv-logo" src={assetsRoot() + 'assets/logo/' + file} alt="Сравни" style={Object.assign({ height: h, width: 'auto' }, props.style)} />;
}
