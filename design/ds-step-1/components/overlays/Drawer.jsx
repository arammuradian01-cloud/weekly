import React from 'react';
import { IconButton } from '../core/IconButton.jsx';
import { Breadcrumbs } from '../navigation/Breadcrumbs.jsx';

/* Боковая панель 560-640 для карточки задачи, просьбы, подразделения. Открывается поверх списка, у неё постоянная ссылка (onCopyLink).
   inline: без затемнения, для макетов. readonly: шапка на сером (чужая задача, архив). */
export function Drawer(props) {
  var panel = (
    <aside className={['sv-drawer', props.readonly ? 'sv-drawer--readonly' : '', props.className || ''].filter(Boolean).join(' ')} role="dialog" aria-modal={!props.inline} aria-label={props.ariaLabel || props.title} style={Object.assign({}, props.width ? { width: props.width } : {}, props.style)}>
      <header className="sv-drawer__head">
        <div className="sv-drawer__head__main">
          {props.crumbs ? <Breadcrumbs items={props.crumbs} /> : null}
          {props.badges ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{props.badges}</div> : null}
          <h2 className="sv-drawer__title">{props.title}</h2>
          {props.subtitle ? <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>{props.subtitle}</div> : null}
        </div>
        <div className="sv-drawer__actions">
          {props.onCopyLink ? <IconButton icon="link" label="Скопировать ссылку" size="sm" onClick={props.onCopyLink} /> : null}
          {props.onExpand ? <IconButton icon="maximize-2" label="Открыть страницей" size="sm" onClick={props.onExpand} /> : null}
          {props.menu}
          <IconButton icon="x" label="Закрыть" size="sm" onClick={props.onClose} />
        </div>
      </header>
      <div className="sv-drawer__body">{props.children}</div>
      {props.footer ? <footer className="sv-drawer__foot">{props.footer}</footer> : null}
    </aside>
  );
  if (props.inline) return panel;
  return <div className={'sv-overlay sv-overlay--right' + (props.fixed ? ' sv-overlay--fixed' : '')} onClick={function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); }}>{panel}</div>;
}
