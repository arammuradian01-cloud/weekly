«Обсудить на встрече»: форма с вопросом одной фразой (MeetingQuestionForm) и пометка «Вопрос к встрече» с кнопкой «Обсуждено» (MeetingQuestion). question: { text, author, about, time, done, doneBy, canClose }.

```jsx
import { MeetingQuestionForm, MeetingQuestion } from './MeetingQuestion.jsx';

<MeetingQuestion />
```

Экспорты: MeetingQuestionForm, MeetingQuestion. Стили: классы `sv-*` в `components/discussion/discussion.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
