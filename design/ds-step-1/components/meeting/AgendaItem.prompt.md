Пункт повестки в списке подготовки: источник (задача, запись, просьба), автор, вопрос одной фразой, примерное время, действия убрать и отложить. item: { n, title, source, sourceLabel, author, minutes, current, done, status }. AgendaItemBig: пункт на проекторе с контекстом.

```jsx
import { AgendaItem, AgendaItemBig } from './AgendaItem.jsx';

<AgendaItem />
```

Экспорты: AgendaItem, AgendaItemBig. Стили: классы `sv-*` в `components/meeting/meeting.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
