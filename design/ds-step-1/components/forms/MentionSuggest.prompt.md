Подсказка @упоминания под полем ввода: аватар, имя и должность, выбор стрелками и Enter. people: [{ id, name, role }], query: введённое после @, activeIndex: выделенный.

```jsx
import { MentionSuggest, Mention } from './MentionSuggest.jsx';

<MentionSuggest />
```

Экспорты: MentionSuggest, Mention. Стили: классы `sv-*` в `components/forms/forms.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
