Таблица задач. Колонки: №, задача и «где сейчас», ответственный, приоритет, статус, состояние, срок. rows: [{ id, title, now, owner, priority, status, state, outside, due, overdueDays, soon, selected, closed, group, blocked }]. groupBy: поле группировки (owner и др.), строки должны быть уже отсортированы. selectable: чекбоксы. onEdit(row, field): правка статуса и состояния в строке. loading: число скелетонных строк. dense: строка 44 (по умолчанию) или comfortable 52.

```jsx
import { InlineEdit, TaskTable } from './TaskTable.jsx';

<TaskTable />
```

Экспорты: InlineEdit, TaskTable. Стили: классы `sv-*` в `components/tasks/tasks.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
