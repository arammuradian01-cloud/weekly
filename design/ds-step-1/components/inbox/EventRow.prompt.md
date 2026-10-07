Строка события в «Мне»: иконка типа на тонированном круге, фраза кто и что, предмет, время, действия «Разобрано» и «Напомнить». type: task, comment, mention, entryComment, reaction, meetingQuestion, request, updateRequest. event: { id, type, who, what, subject, subjectIcon, time, unread, done, request: { onAccept, onDecline } }.

```jsx
import { EventRow, EventList } from './EventRow.jsx';

<EventRow />
```

Экспорты: EventRow, EventList, EVENT_TYPES. Стили: классы `sv-*` в `components/inbox/inbox.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
