Шаги сдачи weekly: «Что обещал», «Задачи», «Главное и записи», «Проверить и сдать». Слева на ноутбуке (vertical), сверху на телефоне (row). steps: [{ key, label, sub }], current: ключ текущего, done: массив пройденных.

```jsx
import { SubmitSteps } from './SubmitSteps.jsx';

<SubmitSteps />
```

Экспорты: SubmitSteps, SUBMIT_STEPS. Стили: классы `sv-*` в `components/weekly/weekly.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
