import React from 'react';
import { Icon } from './Icon.jsx';
import { Kbd } from './Kbd.jsx';

/* Кнопка. variant: primary (главная зелёная, одна на экране), dark, secondary, outline, text, danger.
   size: sm 36, md 44, lg 52. icon: имя Lucide. hotkey: подсказка горячей клавиши. */
export function Button(props) {
  var variant = props.variant || 'outline';
  var size = props.size || 'md';
  var cls = ['sv-btn', 'sv-btn--' + variant, size !== 'md' ? 'sv-btn--' + size : '', props.block ? 'sv-btn--block' : '',
    props.loading ? 'is-loading' : '', props.pressed ? 'is-active' : '', props.className || ''].filter(Boolean).join(' ');
  var Tag = props.href ? 'a' : 'button';
  return (
    <Tag className={cls} href={props.href} type={props.href ? undefined : (props.type || 'button')}
      disabled={props.disabled} aria-busy={props.loading || undefined} onClick={props.onClick} title={props.title} style={props.style}>
      {props.icon ? <Icon name={props.icon} size={size === 'lg' ? 22 : 20} /> : null}
      {props.children}
      {props.iconRight ? <Icon name={props.iconRight} size={size === 'lg' ? 22 : 20} /> : null}
      {props.hotkey ? <Kbd>{props.hotkey}</Kbd> : null}
      {props.loading ? <span className="sv-btn__spinner"><span className="sv-spinner" /></span> : null}
    </Tag>
  );
}
