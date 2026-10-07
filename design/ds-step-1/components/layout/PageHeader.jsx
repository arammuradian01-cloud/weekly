import React from 'react';
import { StructurePath } from '../navigation/StructurePath.jsx';

/* Заголовок страницы: путь по структуре (path), заголовок с меткой (badge), подпись, действия справа (одна главная зелёная), вкладки снизу (tabs). */
export function PageHeader(props) {
  return (
    <header className="sv-page-head" style={props.style}>
      {props.path ? <StructurePath items={props.path} /> : null}
      <div className="sv-page-head__row">
        <div className="sv-page-head__titles">
          <h1 className="sv-page-head__title">{props.title}{props.badge}</h1>
          {props.subtitle ? <div className="sv-page-head__sub">{props.subtitle}</div> : null}
        </div>
        {props.actions ? <div className="sv-page-head__actions">{props.actions}</div> : null}
      </div>
      {props.tabs}
    </header>
  );
}
/* Блок раздела страницы с заголовком, счётчиком, ссылкой «Все» и подсказкой. */
export function Section(props) {
  return (
    <section className="sv-section" style={props.style} aria-label={typeof props.title === 'string' ? props.title : undefined}>
      {props.title ? <div className="sv-section__head"><h2 className="sv-section__title">{props.title}{props.count}</h2>{props.hint ? <span className="sv-section__hint">{props.hint}</span> : null}{props.link ? <a className="sv-section__link" href={props.href || '#'} onClick={props.onLink}>{props.link}</a> : null}</div> : null}
      {props.children}
    </section>
  );
}
/* Колонки содержимого: по умолчанию 2:1, even 1:1, three 1:1:1; на телефоне в одну колонку. */
export function Columns(props) {
  return <div className={['sv-columns', props.even ? 'sv-columns--even' : '', props.three ? 'sv-columns--three' : ''].filter(Boolean).join(' ')} style={props.style}>{props.children}</div>;
}
