Ветка комментариев с @упоминаниями, пометкой «изменено» и меню «Изменить», «Удалить» (свой комментарий правится 15 минут). comments: [{ id, author, time, text | parts: [string | { mention }], edited, mine, canEdit, deleted, reactions }]. Поле ответа с подсказкой про @.

```jsx
import { renderParts, Comment, CommentThread } from './CommentThread.jsx';

<CommentThread />
```

Экспорты: renderParts, Comment, CommentThread. Стили: классы `sv-*` в `components/discussion/discussion.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
