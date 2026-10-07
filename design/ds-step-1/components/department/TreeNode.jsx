import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { TrafficLights } from './TrafficLights.jsx';

/* Узел дерева структуры: название, уровень, руководитель или «не выделен», сколько человек, светофор. func: функциональная связь пунктиром.
   node: { title, level, lead, vacancy, people, vacancies, lights: { weekly, overdue, goals }, func }. open, selected, hasChildren. children: вложенные узлы. */
export function TreeNode(props) {
  var n = props.node || {};
  var hasChildren = props.hasChildren != null ? props.hasChildren : !!props.children;
  return (
    <div>
      <button type="button" className={['sv-tree-node', props.open ? 'is-open' : '', props.selected ? 'is-selected' : '', n.func ? 'sv-tree-node--func' : '', props.plain ? 'sv-tree-node--plain' : ''].filter(Boolean).join(' ')} aria-expanded={hasChildren ? !!props.open : undefined} onClick={props.onClick} style={props.style}>
        <span className="sv-tree-node__toggle">{hasChildren ? <Icon name="chevron-right" size={16} /> : null}</span>
        <span className="sv-tree-node__body">
          <span className="sv-tree-node__title"><span>{n.title}</span>{n.level ? <span className="sv-tree-node__level">{n.level}</span> : null}{n.func ? <span className="sv-tree-node__level">функционально</span> : null}</span>
          <span className="sv-tree-node__sub">
            {n.vacancy ? <Avatar name="Вакансия" size="xs" vacancy /> : n.lead ? <Avatar name={n.lead} size="xs" /> : null}
            <span className={n.lead || n.vacancy ? '' : 'is-none'}>{n.vacancy ? 'Руководитель: вакансия' : n.lead || 'Руководитель не выделен'}</span>
          </span>
        </span>
        <span className="sv-tree-node__side">
          {n.people != null ? <span className="sv-tree-node__count">{n.people} чел.{n.vacancies && props.showVacancies ? ', ' + n.vacancies + ' вак.' : ''}</span> : null}
          {n.lights ? <TrafficLights {...n.lights} /> : null}
        </span>
      </button>
      {props.open && props.children ? <div className={'sv-tree-children' + (props.funcChildren ? ' sv-tree-children--func' : '')}>{props.children}</div> : null}
    </div>
  );
}
