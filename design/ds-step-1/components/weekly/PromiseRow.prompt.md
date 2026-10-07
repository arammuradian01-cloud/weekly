Строка обещания с итогом: четыре кнопки итога (сделано, частично, не сделано, снято), поле на одну фразу и «Перенести на эту неделю». promise: { id, text, from, outcome, note }. readonly: итог без кнопок (лента, профиль).

```jsx
import { PromiseRow } from './PromiseRow.jsx';

<PromiseRow />
```

Экспорты: PromiseRow, OUTCOMES. Стили: классы `sv-*` в `components/weekly/weekly.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
