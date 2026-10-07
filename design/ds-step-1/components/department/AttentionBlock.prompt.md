Блок «Требует внимания»: 5-7 задач команды, которые просрочены, давно не обновлялись или заблокированы, с ответственным и кнопкой «Попросить обновить». items: [{ id, title, owner, why: 'overdue' | 'stale' | 'blocked', whyText, asked }].

```jsx
import { AttentionBlock } from './AttentionBlock.jsx';

<AttentionBlock />
```

Экспорты: AttentionBlock. Стили: классы `sv-*` в `components/department/department.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
