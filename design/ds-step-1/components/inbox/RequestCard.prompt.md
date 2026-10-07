Карточка просьбы: кто, кому, что, к какому сроку, связанная задача, ответ. request: { from, to, text, due, status: waiting | accepted | done | declined | overdue, task, answer: { by, text, due } }. role: recipient (адресат: «Принять и назвать срок», «Отклонить с причиной», «Выполнено», «Сделать задачей») или author («Отозвать», «Напомнить»).

```jsx
import { RequestCard } from './RequestCard.jsx';

<RequestCard />
```

Экспорты: RequestCard. Стили: классы `sv-*` в `components/inbox/inbox.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
