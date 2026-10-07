Переключатель команд в верхней панели слева от недели. teams: [{ id, name, role: 'lead' | 'member', sub }], плюс «Все мои команды» у руководителей. Выбор запоминается. compact: вид для шапки раздела на телефоне.

```jsx
import { TeamSwitcher } from './TeamSwitcher.jsx';

<TeamSwitcher />
```

Экспорты: TeamSwitcher. Стили: классы `sv-*` в `components/navigation/navigation.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
