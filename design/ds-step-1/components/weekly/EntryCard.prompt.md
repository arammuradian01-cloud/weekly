Карточка записи weekly. entry: { type: result | event | risk | plan, block, direction, what, details, impact, fact, next, links: [{ label, href }], help: { to, due }, thanks: { to, for }, ceo, up, author, questionOpen }. collapsed: только тип и первая фраза. Под записью компактная строка реакций и «Обсудить». canUp: кнопка «Наверх» для руководителя. manager: видит флажок CEO.

```jsx
import { EntryCard } from './EntryCard.jsx';

<EntryCard />
```

Экспорты: EntryCard. Стили: классы `sv-*` в `components/weekly/weekly.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
