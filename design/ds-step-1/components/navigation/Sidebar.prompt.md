Боковое меню 248. items: [{ key, label, icon, count, group }], группа «Управление» видна владельцу и администраторам. variant: dark (тёмно-синее) или light (как шапка сайта). Внизу профиль: имя, роль, тема, выход. Место под официальный знак: logo (ReactNode) или пунктирная заглушка.

```jsx
import { Sidebar } from './Sidebar.jsx';

<Sidebar />
```

Экспорты: Sidebar, SIDEBAR_ITEMS. Стили: классы `sv-*` в `components/navigation/navigation.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
