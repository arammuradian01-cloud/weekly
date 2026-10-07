Карточка решения: формулировка, владелец, дата встречи, связанные задачи, статус «в силе» или «отменено». decision: { text, owner, date, tasks: [{ id, title }], cancelled, cancelledBy, cancelledAt, protocol }.

```jsx
import { DecisionCard } from './DecisionCard.jsx';

<DecisionCard />
```

Экспорты: DecisionCard. Стили: классы `sv-*` в `components/meeting/meeting.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
