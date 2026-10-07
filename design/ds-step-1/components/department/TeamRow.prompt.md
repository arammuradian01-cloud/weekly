Строка команды в «Моих командах»: руководитель, «weekly сдали N из M», задач в работе, просрочено, требует уточнений, давно не обновлялись, целей в риске. team: { name, lead, mine, weeklyDone, weeklyTotal, inWork, overdue, clarify, stale, goalsRisk, lights }. TeamList: обёртка с шапкой.

```jsx
import { TeamRow, TeamList } from './TeamRow.jsx';

<TeamRow />
```

Экспорты: TeamRow, TeamList. Стили: классы `sv-*` в `components/department/department.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
