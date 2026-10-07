Поле пароля с кнопкой «Показать пароль» и подсказкой требований под полем. rules: показывать список требований (для «Придумайте пароль»); login, name: для проверки «без логина, имени и фамилии».

```jsx
import { checkPassword, PasswordInput } from './PasswordInput.jsx';

<PasswordInput />
```

Экспорты: checkPassword, PasswordInput. Стили: классы `sv-*` в `components/forms/forms.css`, значения только из токенов `styles.css`. Все тексты на русском, на «вы», глагол в начале кнопки, без восклицательных знаков.
