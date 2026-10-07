Реакции «Принято», «Вопрос», «Обсудить на встрече», «Спасибо». Повторное нажатие снимает свою. compact: строка со счётчиками для ленты; полная панель с именами (full): value: { accepted: ['Влад', ...], ... }. value в compact: { accepted: 3, question: 1 } или массивы имён. mine: ключ своей реакции. discussCount: число комментариев для кнопки «Обсудить».

```jsx
import { Reactions } from './Reactions.jsx';

<Reactions />
```

Экспорты: Reactions, REACTIONS. Стили: классы `sv-*` в `components/discussion/discussion.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
