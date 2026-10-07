import React from 'react';
import { Button } from '../core/Button.jsx';

/* «Показать ещё»: кнопка с остатком. shown, total. */
export function ShowMore(props) {
  var rest = (props.total || 0) - (props.shown || 0);
  if (rest <= 0) return null;
  return <div className="sv-show-more" style={props.style}><Button variant="outline" size="sm" onClick={props.onMore} loading={props.loading}>Показать ещё {Math.min(rest, props.step || 20)}</Button><span className="sv-show-more__hint">показано {props.shown} из {props.total}</span></div>;
}
