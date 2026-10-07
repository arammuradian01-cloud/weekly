import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Полоса «Тестовый стенд» под шапкой: жёлтый фон, жирное начало, иконка колбы. title: жирная часть, children: пояснение. */
export function StandBanner(props) {
  return (
    <div className="sv-stand" role="status" style={props.style}>
      <Icon name={props.icon || 'flask-conical'} size={16} />
      <span><strong>{props.title || 'Тестовый стенд.'}</strong> {props.children}</span>
    </div>
  );
}
