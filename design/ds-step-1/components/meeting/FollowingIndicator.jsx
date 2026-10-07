import React from 'react';
import { Button } from '../core/Button.jsx';
import { Icon } from '../core/Icon.jsx';
import { Kbd } from '../core/Kbd.jsx';
import { MeetingTimer } from './MeetingTimer.jsx';
import { IconButton } from '../core/IconButton.jsx';

/* Индикатор для участника: «Вы смотрите пункт ведущего» или «Вы отошли» с кнопкой «Вернуться к ведущему». */
export function FollowingIndicator(props) {
  if (props.away) {
    return <div className="sv-follow sv-follow--away" role="status" style={props.style}><span className="sv-follow__dot" />Ведущий на пункте {props.leaderStep}<Button size="sm" variant="outline" onClick={props.onReturn}>Вернуться к ведущему</Button></div>;
  }
  return <div className="sv-follow" role="status" style={props.style}><span className="sv-follow__dot" />Вы смотрите пункт ведущего</div>;
}
/* Тонкая полоса сверху в режиме ведущего: название встречи, пункт N из M, таймер, выход. */
export function MeetingBar(props) {
  return (
    <header className="sv-meeting-bar" style={props.style}>
      <span className="sv-meeting-bar__title">{props.title || 'Weekly топ-команды, вт 13.10'}</span>
      <span className="sv-meeting-bar__step">пункт {props.step} из {props.total}</span>
      <span className="sv-meeting-bar__spacer" />
      <MeetingTimer seconds={props.seconds} total={props.total420 || 420} paused={props.paused} />
      <IconButton icon="x" label="Выйти из режима встречи" onClick={props.onExit} />
    </header>
  );
}
/* Подсказки клавиш снизу на проекторе */
export function MeetingKeys(props) {
  return (
    <footer className="sv-meeting-keys" style={props.style}>
      <span><Kbd>←</Kbd><Kbd>→</Kbd> пункты</span><span><Kbd>T</Kbd> задача</span><span><Kbd>R</Kbd> решение</span><span><Kbd>Space</Kbd> таймер</span>{props.children}
    </footer>
  );
}
