import React from 'react';
import { Kbd } from '../core/Kbd.jsx';

/* Подсказка: тёмная плашка, одна фраза, иногда с клавишей. Появляется при наведении и фокусе на обёрнутом элементе. staticTip: показать сразу (для макетов). */
export function Tooltip(props) {
  var tip = <span className={'sv-tooltip' + (props.arrow !== false ? ' sv-tooltip--top' : '')} role="tooltip">{props.text}{props.hotkey ? <Kbd>{props.hotkey}</Kbd> : null}</span>;
  if (props.staticTip) return tip;
  return <span className="sv-tip-wrap">{props.children}{tip}</span>;
}
