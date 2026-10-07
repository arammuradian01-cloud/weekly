import React from 'react';
import { IconCircle } from '../core/Icon.jsx';
import { Icon } from '../core/Icon.jsx';

/* Плитка как на главной сайта: крупная скруглённая карточка (радиус 24) с заголовком, подписью, иконкой на круге и цифрой или действием.
   tone: default, accent (светло-голубая), brand (тёмно-синяя), primary (зелёная, одна на экране). wide: на две колонки. value, unit: крупная цифра. */
export function Tile(props) {
  var Tag = props.href ? 'a' : 'div';
  return (
    <Tag className={['sv-tile', props.tone ? 'sv-tile--' + props.tone : '', props.wide ? 'sv-tile--wide' : '', props.className || ''].filter(Boolean).join(' ')} href={props.href} role={props.href ? undefined : 'button'} tabIndex={props.href ? undefined : 0} onClick={props.onClick} style={props.style}>
      <div className="sv-tile__top">
        <div style={{ minWidth: 0 }}><h3 className="sv-tile__title">{props.title}</h3>{props.sub ? <div className="sv-tile__sub">{props.sub}</div> : null}</div>
        {props.icon ? <IconCircle name={props.icon} tone={props.iconTone || (props.tone === 'brand' || props.tone === 'primary' ? 'neutral' : 'accent')} size={40} iconSize={20} /> : null}
      </div>
      {props.value != null ? <div className="sv-tile__value">{props.value}{props.unit ? <small>{props.unit}</small> : null}</div> : null}
      {props.children ? <div className="sv-tile__foot">{props.children}</div> : null}
      {props.arrow ? <div className="sv-tile__foot" style={{ justifyContent: 'flex-end' }}><Icon name="arrow-right" size={20} /></div> : null}
    </Tag>
  );
}
export function Tiles(props) {
  return <div className="sv-tiles" style={props.style}>{props.children}</div>;
}
