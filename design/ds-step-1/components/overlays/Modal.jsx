import React from 'react';
import { IconButton } from '../core/IconButton.jsx';
import { Button } from '../core/Button.jsx';
import { IconCircle } from '../core/Icon.jsx';

/* Окно. size: sm 440, md 560, lg 760. footer: кнопки справа. inline: без затемнения. */
export function Modal(props) {
  var box = (
    <div className={['sv-modal', props.size && props.size !== 'md' ? 'sv-modal--' + props.size : '', props.className || ''].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-labelledby="sv-modal-title" style={props.style}>
      <header className="sv-modal__head">
        <h2 className="sv-modal__title" id="sv-modal-title">{props.title}</h2>
        {props.onClose ? <IconButton icon="x" label="Закрыть" size="sm" onClick={props.onClose} /> : null}
      </header>
      <div className="sv-modal__body">{props.children}</div>
      {props.footer ? <footer className={'sv-modal__foot' + (props.footerBetween ? ' sv-modal__foot--between' : '')}>{props.footer}</footer> : null}
    </div>
  );
  if (props.inline) return box;
  return <div className={'sv-overlay sv-overlay--center' + (props.fixed ? ' sv-overlay--fixed' : '')} onClick={function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); }}>{box}</div>;
}
/* Окно подтверждения: одна фраза о последствии, кнопка называет действие глаголом. danger: красная кнопка для удаления. */
export function ConfirmDialog(props) {
  return (
    <Modal size="sm" title={props.title} onClose={props.onCancel} inline={props.inline} fixed={props.fixed}
      footer={[<Button key="c" variant="text" onClick={props.onCancel}>{props.cancelLabel || 'Отменить'}</Button>,
        <Button key="ok" variant={props.danger ? 'danger' : 'dark'} onClick={props.onConfirm} loading={props.loading}>{props.confirmLabel || 'Подтвердить'}</Button>]}>
      {props.icon ? <div className="sv-confirm__icon"><IconCircle name={props.icon} tone={props.danger ? 'danger' : 'accent'} /></div> : null}
      {typeof props.children === 'string' ? <p>{props.children}</p> : props.children}
    </Modal>
  );
}
