import React from 'react';
import { Sidebar } from '../navigation/Sidebar.jsx';
import { TopBar } from '../navigation/TopBar.jsx';
import { BottomNav } from '../navigation/BottomNav.jsx';
import { SiteHeader } from './SiteHeader.jsx';

/* Оболочка приложения. variant: sidebar (тёмно-синее или светлое боковое меню 248 + верхняя панель) или header (светлая шапка как на сайте).
   Перестраивается сама по ширине контейнера: от 1260 полное меню, 1024-1259 меню иконками 72, 768-1023 шапка с разделами в строку, до 767 компактная шапка и нижнее меню.
   Пропсы меню и панелей: sidebar, topBar, header, bottomNav (объекты пропсов), active, counts, isManager, isAdmin. Содержимое: children (внутри .sv-shell__content, id="content"). */
export function AppShell(props) {
  var variant = props.variant || 'sidebar';
  var common = { active: props.active, counts: props.counts, isManager: props.isManager, isAdmin: props.isAdmin, onSelect: props.onSelect };
  return (
    <div className="sv-shell-root" style={props.style}>
    <div className={['sv-shell', variant === 'header' ? 'sv-shell--header' : '', props.className || ''].filter(Boolean).join(' ')} style={{ height: '100%' }}>
      <aside className="sv-shell__side"><Sidebar {...common} {...(props.sidebar || {})} variant={props.sidebarVariant || (props.sidebar && props.sidebar.variant) || 'dark'} dark={props.dark} /></aside>
      <div className="sv-shell__top"><TopBar {...(props.topBar || {})} /></div>
      <div className="sv-shell__header"><SiteHeader {...common} {...(props.header || {})} /></div>
      <main className="sv-shell__main" id="content" tabIndex={-1}><div className="sv-shell__content">{props.children}</div></main>
      <div className="sv-shell__bottom"><BottomNav active={props.active} counts={props.counts} manager={props.isManager} onSelect={props.onSelect} {...(props.bottomNav || {})} /></div>
    </div>
    </div>
  );
}
