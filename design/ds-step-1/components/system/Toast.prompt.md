Тост: «Сохранено», «Задача создана», «Не сохранилось» с «Повторить», «Удалено» с «Отменить» на 5 секунд. Несколько стопкой (ToastStack). toast: { id, tone: success | error | info | neutral, text, action: { label, onClick }, progress: 0..100 }.

```jsx
import { Toast, ToastStack } from './Toast.jsx';

<Toast />
```

Экспорты: Toast, ToastStack. Стили: классы `sv-*` в `components/system/system.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
