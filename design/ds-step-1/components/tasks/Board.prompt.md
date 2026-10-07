Колонка статуса и карточка задачи для доски и вида «По статусам». Полоска слева показывает состояние: ok, risk, blocked. BoardCard: { id, title, owner, due, overdueDays, state, blocked, priority, dragging, placeholder }.

```jsx
import { BoardColumn, BoardCard, Board } from './Board.jsx';

<Board />
```

Экспорты: BoardColumn, BoardCard, Board. Стили: классы `sv-*` в `components/tasks/tasks.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
