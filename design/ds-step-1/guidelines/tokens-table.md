# Таблица токенов для этапа 18

Имена токенов те же, что в `src/app/globals.css` этапа 10, где они были; новые роли добавлены. Старые имена (text-micro, text-tiny, text-caption 13 и другие 17 размеров, amber, mist, steel, orange-soft, orange-ink, warning-line, danger-line, danger-on-dark, fill-navy, fill-green) сводятся к новым по колонке «Примечание». Тёмная тема задаётся на `[data-theme="dark"]`; «как в системе» через `prefers-color-scheme` и тот же атрибут.

| Группа | Токен | Светлая | Тёмная | CSS-переменная | Имя в @theme Tailwind 4 | Класс | Примечание |
|---|---|---|---|---|---|---|---|
| Цвета | page | #F6F5F4 | #080A0C | --color-page | --color-page | bg-page | сайт D06; был фон страницы |
| Цвета | surface | #FFFFFF | #171D23 | --color-surface | --color-surface | bg-surface | сайт L100 |
| Цвета | field | #F5F5F5 | #2B2E33 | --color-field | --color-field | bg-field | сайт D10; заливка полей, тегов, вторичных кнопок |
| Цвета | text | #171D23 | #FFFFFF | --color-text | --color-text | text-text | сайт D100 |
| Цвета | text-secondary | #636F7D | #9198A1 | --color-text-secondary | --color-text-secondary | text-text-secondary | сайт D60; был text-muted |
| Цвета | text-disabled | #99A1AB | #636F7D | --color-text-disabled | --color-text-disabled | text-text-disabled | сайт D30; тёмная своё |
| Цвета | icon | #7E8894 | #78808C | --color-icon | --color-icon | text-icon, border-icon | сайт D40; иконки в полях, рамки полей, чекбоксов; был steel |
| Цвета | border | #DADDE2 | #4E5764 | --color-border | --color-border | border-border | сайт D15; был mist |
| Цвета | border-strong | #B3BAC3 | #78808C | --color-border-strong | --color-border-strong | border-border-strong | сайт D20 |
| Цвета | brand-dark | #002A3A | #002A3A | --color-brand-dark | --color-brand-dark | bg-brand-dark | сайт B300; был navy / fill-navy |
| Цвета | accent | #00AFFF | #00AFFF | --color-accent | --color-accent | bg-accent | сайт B100; не для текста на белом |
| Цвета | on-accent | #002A3A | #171D23 | --color-on-accent | --color-on-accent | text-on-accent | текст на голубом |
| Цвета | accent-soft | #F0FAFF | #0F2A3A | --color-accent-soft | --color-accent-soft | bg-accent-soft | сайт B06; тёмная своё |
| Цвета | accent-soft-border | #B6E6FC | #1E5F80 | --color-accent-soft-border | --color-accent-soft-border | border-accent-soft-border | сайт B30; тёмная своё |
| Цвета | link | #0073A8 | #00AFFF | --color-link | --color-link | text-link | своё 5,2:1; был ссылочный синий флажков |
| Цвета | focus | #0073A8 | #00AFFF | --color-focus | --color-focus | outline-focus | своё |
| Цвета | primary | #0DD149 | #0DD149 | --color-primary | --color-primary | bg-primary | сайт G100; был fill-green |
| Цвета | primary-hover | #0CBC42 | #0CBC42 | --color-primary-hover | --color-primary-hover | bg-primary-hover | своё 5,95:1 |
| Цвета | primary-active | #0BB43F | #0BB43F | --color-primary-active | --color-primary-active | bg-primary-active | своё 5,47:1 |
| Цвета | on-primary | #002A3A | #002A3A | --color-on-primary | --color-on-primary | text-on-primary | 7,35:1 |
| Цвета | success-text | #11693F | #9EEDB6 | --color-success-text | --color-success-text | text-success-text | сайт G300 |
| Цвета | success-bg | #EEFCF2 | #1D3E28 | --color-success-bg | --color-success-bg | bg-success-bg | сайт G06 |
| Цвета | success-dot | #0DD149 | #0DD149 | --color-success-dot | --color-success-dot | bg-success-dot | сайт G100 |
| Цвета | warning-text | #725122 | #F5DAB5 | --color-warning-text | --color-warning-text | text-warning-text | сайт O300; был orange-ink |
| Цвета | warning-bg | #FFF9F0 | #503F26 | --color-warning-bg | --color-warning-bg | bg-warning-bg | сайт O06; был orange-soft |
| Цвета | warning-dot | #FF9500 | #FF9500 | --color-warning-dot | --color-warning-dot | bg-warning-dot | сайт O100; был amber / warning-line |
| Цвета | danger-text | #C11D1D | #F1B2B2 | --color-danger-text | --color-danger-text | text-danger-text | сайт R100; был danger-line, danger-on-dark |
| Цвета | danger-bg | #FDF2F2 | #533232 | --color-danger-bg | --color-danger-bg | bg-danger-bg | сайт R06; фон просроченной строки |
| Цвета | danger-dot | #C11D1D | #F28B8B | --color-danger-dot | --color-danger-dot | bg-danger-dot | тёмная своё |
| Цвета | info-text | #5047D7 | #CECBFF | --color-info-text | --color-info-text | text-info-text | сайт V100 |
| Цвета | info-bg | #F3F2FC | #363352 | --color-info-bg | --color-info-bg | bg-info-bg | сайт V06 |
| Цвета | row-hover | #FAFAF9 | #1D242B | --color-row-hover | --color-row-hover | bg-row-hover | своё |
| Цвета | sidebar-bg | #002A3A | #0E1419 | --color-sidebar-bg | --color-sidebar-bg | bg-sidebar-bg | тёмная своё |
| Цвета | overlay | rgba(0,42,58,.4) | rgba(0,0,0,.6) | --color-overlay | --color-overlay | bg-overlay |  |
| Шрифты | font-heading | "Aeroport", "Golos Text" | то же | --font-heading | --font-heading | font-heading | вес 700 |
| Шрифты | font-body | "Open Sans" | то же | --font-body | --font-body | font-body | 400 и 600 |
| Шкала | text-page | 28/32 (телефон 25/32, проектор 50/52) | то же | --text-page | --text-page | text-page | заменяет text-page, text-page-lg, text-headline-lg, text-headline, text-display-sm |
| Шкала | text-section | 22/26 (21/27, 38/44) | то же | --text-section | --text-section | text-section | заменяет text-headline-sm, text-title-lg, text-title |
| Шкала | text-card | 16/20 (16/20, 28/32) | то же | --text-card | --text-card | text-card | заменяет text-title-sm, text-lead для заголовков |
| Шкала | text-lead | 16/20 (16/20, 24/32) | то же | --text-lead | --text-lead | text-lead | кнопки 52 и поля на телефоне |
| Шкала | text-body | 14/20 (14/20, 24/32) | то же | --text-body | --text-body | text-body | заменяет text-body 15, text-small 14 |
| Шкала | text-small | 14/20, 600 (16/20, 24/32) | то же | --text-small | --text-small | text-small | выделенный текст и кнопки |
| Шкала | text-caption | 12/16 (12/16, 18/24) | то же | --text-caption | --text-caption | text-caption | заменяет text-caption 13, text-tiny 12, text-micro 11 |
| Шкала | text-table-head | 12/16, 600 (12/16, 16/20) | то же | --text-table-head | --text-table-head | text-table-head |  |
| Шкала | text-number | 28/32 (25/32, 50/52) | то же | --text-number | --text-number | text-number | заменяет text-hero, text-display |
| Радиусы | radius-control | 8px | то же | --radius-control | --radius-control | rounded-control | кнопки и поля 36, 44 |
| Радиусы | radius-control-lg | 12px | то же | --radius-control-lg | --radius-control-lg | rounded-control-lg | кнопки 52, аватары, меню |
| Радиусы | radius-card | 16px | то же | --radius-card | --radius-card | rounded-card |  |
| Радиусы | radius-panel | 24px | то же | --radius-panel | --radius-panel | rounded-panel | боковая панель, окна |
| Радиусы | radius-tag | 20px | то же | --radius-tag | --radius-tag | rounded-tag | теги, бейджи |
| Радиусы | radius-pill | 32px | то же | --radius-pill | --radius-pill | rounded-pill | фильтры-пилюли |
| Тени | shadow-small | 0 -2px 6px rgba(0,0,0,.02), 0 10px 14px rgba(20,36,56,.06) | rgba(0,0,0,.10) и .30 | --shadow-small | --shadow-small | shadow-small | подсказки, календарь; = shadow-segment |
| Тени | shadow-medium | 0 12px 16px rgba(0,0,0,.06) | 0 12px 16px rgba(0,0,0,.35) | --shadow-medium | --shadow-medium | shadow-medium | карточки при наведении, меню, окна; = shadow-menu, shadow-modal, shadow-drag |
| Тени | shadow-sticky | 0 12px 16px rgba(0,0,0,.12) | 0 12px 16px rgba(0,0,0,.50) | --shadow-sticky | --shadow-sticky | shadow-sticky | залипающие панели; = shadow-toast, shadow-drawer |
| Отступы | space-1..10 | 4, 8, 12, 16, 20, 24, 32, 40 | то же | --space-N | --spacing | p-N, gap-N | шаг 4; базовая единица Tailwind |
| Сетка | sidebar-width | 248px | то же | --sidebar-width | --width-sidebar | w-sidebar |  |
| Сетка | content-max | 1320px | то же | --content-max | --container-page | max-w-page | был max-w-page |
| Сетка | content-pad | 30px / 16px телефон | то же | --content-pad | --spacing-content-pad | px-content-pad |  |
| Сетка | drawer-width | 600px | то же | --drawer-width | --width-drawer | w-drawer | 560-640 |
| Фокус | focus-outline | 2px solid #0073A8, offset 2 | 2px solid #00AFFF | --focus-outline | --focus-outline | outline-focus | своё, у сайта 1 px |
| Движение | duration | 300ms | то же | --duration | --duration | duration | 0 при prefers-reduced-motion |
| Движение | duration-color | 200ms | то же | --duration-color | --duration-color | duration-color |  |
| Движение | ease | cubic-bezier(.46,0,.03,.99) | то же | --ease | --ease | ease | сайт |

## Компоненты и имена в коде

Имена компонентов в `components/` совпадают с именами для кода: Button, IconButton, Input, Textarea, PasswordInput, Select, PersonPicker, DatePicker, MentionSuggest, Checkbox, Radio, Switch, Segmented, FormField, Sidebar, TopBar, BottomNav, Tabs, FilterPill, FilterPills, WeekSwitcher, Breadcrumbs, StructurePath, TeamSwitcher, StatusBadge, PriorityMark, StateDot, OverdueLabel, Tag, CounterBadge, Avatar, AvatarGroup, TaskTable, InlineEdit, BulkActionsBar, Board, BoardColumn, BoardCard, PeopleRow, StatusHistoryBar, Drawer, Modal, ConfirmDialog, BottomSheet, SheetRow, Menu, Tooltip, CommentThread, Comment, Mention, MentionWarning, Reactions, MeetingQuestion, MeetingQuestionForm, EventRow, EventList, RequestCard, WaitingBlock, SubmitSteps, WeekDays, SubmissionBar, EntryCard, UpBadge, PromiseRow, DraftHint, SavedMark, Deadline, AgendaItem, AgendaItemBig, MeetingTimer, MeetingBar, MeetingKeys, DecisionCard, FollowingIndicator, Toast, ToastStack, Alert, EmptyState, Skeleton, SkeletonRow, SkeletonCard, ShowMore, CommandPalette, BarLineChart, Sparkline, GoalProgress, TreeNode, TrafficLights, TeamRow, TeamList, PersonRow, AttentionBlock, UnitSummary.

Словари состояний: TASK_STATUS, WEEKLY_STATUS, REQUEST_STATUS (StatusBadge), PRIORITY (PriorityMark), STATE (StateDot), REACTIONS (Reactions), EVENT_TYPES (EventRow), OUTCOMES (PromiseRow), SUBMIT_STEPS, SIDEBAR_ITEMS, CMDK_ACTIONS.
