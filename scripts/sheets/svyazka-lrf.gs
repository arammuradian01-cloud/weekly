/**
 * Таблица-связка для ресурса Weekly (Сравни, страхование и инвестиции).
 *
 * По вкладке на каждый нужный лист источника, в A1 формула IMPORTRANGE на занятую область этого листа с запасом в
 * 200 строк и 40 столбцов. Данные в источниках скрипт не меняет, расписаний не создаёт.
 *
 * Версия 8 (11.10). Три предела Google, из-за которых скрипт устроен сложнее, чем кажется:
 * 1. Шесть минут на прогон. Скрипт работает частями: за прогон делает столько, сколько успевает за четыре минуты,
 *    запоминает место остановки и пишет журнал. Следующий запуск продолжает с того же места, уже связанные вкладки
 *    пропускает без обращения к источнику. Когда очередь заканчивается, место остановки сбрасывается и в журнале
 *    появляется строка «Очередь пройдена». У связывания и у пересчёта место остановки своё.
 * 2. Десять миллионов ячеек на таблицу. Поэтому вкладка получает размер занятой области, а не всего листа, и первыми
 *    связываются листы, которые читает ресурс: четыре из LRF, пять из LRF партнёрского канала, TOTAL из Weekly Sravni.
 * 3. Размер одного IMPORTRANGE: лист на 700 строк и 337 столбцов приходит, на 1000 строк уже нет («Результат слишком
 *    большой»). Большие листы берутся равными частями по строкам и склеиваются в одну вкладку фигурными скобками:
 *    ={IMPORTRANGE(часть 1);IMPORTRANGE(часть 2)}. Для ресурса такая вкладка выглядит как обычный лист.
 *
 * Таблица в русской локали: в формулах аргументы разделяются точкой с запятой, а не запятой. Разделитель
 * определяется пробной формулой и запоминается, иначе все IMPORTRANGE падают с синтаксической ошибкой.
 *
 * Что не связывается:
 * - из LRF и из LRF партнёрского канала листы ERE (затраты на персонал);
 * - из Metrics всё, кроме листов страхования (метрики других департаментов);
 * - из Weekly Sravni всё, кроме TOTAL (цифры недели для ресурса).
 *
 * Функции:
 * - linkAll: связать новые листы, продолжая прошлую очередь;
 * - svyazkaPereschet: пройти по уже связанным вкладкам и подогнать размер под выросший источник. Долго, за несколько
 *   прогонов. Нужен раз в квартал и после больших правок в LRF: linkAll этого сам не замечает;
 * - svyazkaProverit: показать вкладки, где в A1 ошибка;
 * - svyazkaRazbit: пересобрать частями вкладки, которым не хватило размера одного IMPORTRANGE;
 * - svyazkaPochinit: переписать формулы заново, заново определив разделитель;
 * - svyazkaSbros: начать очередь сначала и забыть разделитель.
 *
 * Руками в этой таблице ничего не правят: вкладки и формулы ставит этот скрипт.
 */

const LRF = '1NyXreA9PYUC-CTeUmIvh_w1L7kIggCxhjpo5-f5vK7k';
const METRICS = '116ZXzrKwEI5D6B9Rm7_Jm6vfVms-nuxZ9hDlvvZjxEY';
/** LRF партнёрского канала «b2b channel: 5Y_LRF (CURRENT)»: для прогноза партнёрского канала (этап 35 ресурса) */
const B2B = '1d6Dbxr7qg9-2d4FgIxLawGEAcMcTR_kMbWh7uPD1uQc';
/** Недельный отчёт «Weekly Sravni» (боевой, у аналитика): ресурсу нужен лист TOTAL для цифр недели (М9). Доступ служебному
    аккаунту даётся только к этой таблице-связке, боевой отчёт не открывается (решение Арама 11.10) */
const WEEKLY = '1r4A8NMYprY6BoWae_OjDFXqaT5XF2j7CXQHwRnJuqWw';
const WEEKLY_TABS = ['TOTAL'];

const METRICS_TABS = [
  'Метрики от CEO INS',
  'OSAGO',
  'ALL CPO Insurance. Reva',
  'ALL CPO Insurance. Reva data',
  'Ins Bus OSAGO. Golovkin',
  'Ins Bus OSAGO. Golovkin data',
  'Ins PO OSAGO. Reva',
  'Ins PO OSAGO. Reva data',
  'pnl_import',
  'pnl_import_red',
  'OSAGO IT partner. Terehov',
  'OSAGO IT partner. Terehov data',
  'Marketing INS. Search',
  'CMO INS. Search data',
  'Partner sales. Afanasiev',
  'Partner sales. Afanasiev data',
  'КАМ Insurance partners',
  'КАМ Банковский канал/Спецы data',
  'КАМ Insurance Agent',
  'Агентский канал data',
  'КАМ insurance',
  'Head of Agent Канал. Оксаненко',
];

/** Листы, которые читает ресурс: связываются первыми. Имена как в источниках, вместе с двоеточиями и пробелами.
    Те же имена лежат в коде ресурса: LRF в src/lib/plan/spec.ts, партнёрский канал в src/lib/plan/partners.ts.
    Расхождение ловит юнит-тест tests/unit/svyazka-script.test.ts: если имя поменяли там, поменяйте и здесь */
const REQUIRED = {
  [LRF]: ['OSAGO_KEY METRICS', 'RED_KEY METRICS', 'CASCO LRF', 'DEPOSITS_KEY METRICS'],
  [B2B]: ['CPA & WAYBACK: OSAGO LRF', 'AGENTS: OSAGO LRF', 'CPA & WAYBACK: RED LRF', 'AGENTS: RED LRF', 'PnL_b2b'],
  [WEEKLY]: WEEKLY_TABS,
};

const SOURCES = [
  { id: LRF, prefix: '', take: (name) => !/(^|[^A-Za-z])ERE([^A-Za-z]|$)/.test(name) },
  { id: METRICS, prefix: 'Metrics. ', take: (name) => METRICS_TABS.indexOf(name) >= 0 },
  { id: B2B, prefix: 'B2B. ', take: (name) => !/(^|[^A-Za-z])ERE([^A-Za-z]|$)/.test(name) },
  { id: WEEKLY, prefix: 'Weekly. ', take: (name) => WEEKLY_TABS.indexOf(name) >= 0 },
];

/** Предел ячеек в одной Google-таблице 10 млн, оставляем запас */
const CELL_LIMIT = 9500000;
/** Запас сверх занятой области источника: строки на новые записи, столбцы на новые недели и месяцы */
const ROWS_EXTRA = 200;
const COLS_EXTRA = 40;
/** Google обрывает скрипт на шести минутах, поэтому останавливаемся сами и запоминаем место */
const TIME_BUDGET_MS = 4 * 60 * 1000;
const CURSOR_KEY = 'svyazka_cursor';
const SEP_KEY = 'svyazka_sep';
/** Технический лист для пробной формулы: живёт несколько секунд внутри argSep */
const PROBE_TAB = '_разделитель';
/** Сколько ячеек берёт один IMPORTRANGE. Проверено: 236 тысяч приходят, 337 тысяч уже нет. Берём с запасом */
const IMPORT_LIMIT = 150000;

/** Разделитель аргументов в формулах: в русской локали точка с запятой. Определяем пробной формулой и запоминаем */
function argSep(ss, again) {
  const props = PropertiesService.getDocumentProperties();
  const saved = props.getProperty(SEP_KEY);
  if (saved && !again) return saved;
  // Остаток от прерванного прогона: иначе вставка листа с тем же именем падает
  const left = ss.getSheetByName(PROBE_TAB);
  if (left) ss.deleteSheet(left);
  const probe = ss.insertSheet(PROBE_TAB, ss.getSheets().length);
  let sep = ',';
  try {
    probe.getRange('A1').setFormula('=SUM(1,2)');
    SpreadsheetApp.flush();
    if (probe.getRange('A1').getValue() !== 3) sep = ';';
  } finally {
    ss.deleteSheet(probe);
  }
  props.setProperty(SEP_KEY, sep);
  return sep;
}

function importFormula(sep, url, range) {
  return '=IMPORTRANGE("' + url + '"' + sep + '"' + range.replace(/"/g, '""') + '")';
}

/** Номер столбца по имени: ET это 150 */
function colIndex(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n;
}

/** Сколько частей нужно листу такого размера: одна, если он влезает в один IMPORTRANGE */
function partsCount(rows, cols) {
  return Math.ceil(rows / Math.max(1, Math.floor(IMPORT_LIMIT / cols)));
}

/** Формула вкладки: один IMPORTRANGE, а для большого листа несколько частей по строкам, склеенных в один массив.
    У всех частей одинаковые столбцы, иначе склейка целиком превращается в ошибку. Пустых частей не бывает: число
    строк в части считается от общего числа строк, а не от предела */
function sheetFormula(sep, url, name, rows, cols) {
  const range = (from, to) => "'" + name.replace(/'/g, "''") + "'!A" + from + ':' + colName(cols) + to;
  const count = partsCount(rows, cols);
  if (count <= 1) return importFormula(sep, url, range(1, rows));
  const per = Math.ceil(rows / count);
  const parts = [];
  for (let from = 1; from <= rows; from += per) {
    parts.push(importFormula(sep, url, range(from, Math.min(rows, from + per - 1))).slice(1));
  }
  return '={' + parts.join(';') + '}';
}

/** Что сейчас в A1 каждой вкладки: ошибка доступа, ошибка размера или данные */
function svyazkaProverit() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const values = sheets.map((sh) => sh.getRange('A1').getValue());
  const bad = [];
  for (let i = 0; i < sheets.length; i++) {
    const v = values[i];
    if (typeof v === 'string' && v.charAt(0) === '#') bad.push(sheets[i].getName() + ': ' + v);
  }
  Logger.log('Вкладок: ' + sheets.length + ', с ошибкой: ' + bad.length + (bad.length ? '\n' + bad.join('\n') : ''));
}

/** Разобрать формулу вкладки: адрес источника, имя листа и размер. Понимает и одиночную формулу, и склейку частями */
function parseFormula(formula) {
  const all = [...String(formula).matchAll(/IMPORTRANGE\("([^"]*)"\s*[,;]\s*"'(.*?)'!A(\d+):([A-Z]+)(\d+)"\)/g)];
  if (!all.length) return null;
  const first = all[0];
  const last = all[all.length - 1];
  return { url: first[1], name: first[2].replace(/''/g, "'"), cols: colIndex(first[4]), rows: Number(last[5]), parts: all.length };
}

/** Пересобрать частями вкладки, где IMPORTRANGE не вернул данные из-за размера */
function svyazkaRazbit() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sep = argSep(ss);
  const sheets = ss.getSheets();
  const cells = sheets.map((sh) => sh.getRange('A1'));
  const values = cells.map((c) => c.getValue());
  const formulas = cells.map((c) => c.getFormula());
  const work = [];
  const skipped = [];
  for (let i = 0; i < sheets.length; i++) {
    if (typeof values[i] !== 'string' || values[i].charAt(0) !== '#') continue;
    const at = parseFormula(formulas[i]);
    if (!at) {
      skipped.push(sheets[i].getName() + ': ' + values[i]);
      continue;
    }
    const now = sheetFormula(sep, at.url, at.name, at.rows, at.cols);
    if (now === formulas[i]) {
      skipped.push(sheets[i].getName() + ': ' + values[i] + ', размер ни при чём');
      continue;
    }
    work.push({ cell: cells[i], name: sheets[i].getName() + ' (частей: ' + partsCount(at.rows, at.cols) + ')', formula: now });
  }
  for (const w of work) w.cell.setFormula(w.formula);
  Logger.log('Пересобрано частями: ' + work.length + (work.length ? '\n' + work.map((w) => w.name).join('\n') : '') + '\nОсталось с ошибкой: ' + skipped.length + (skipped.length ? '\n' + skipped.join('\n') : ''));
}

/** Переписать формулы уже связанных вкладок с правильным разделителем. Сначала читаем все формулы, потом пишем:
    чтение сразу после записи заставляет Google сбрасывать буфер на каждой вкладке, и прогон не укладывается в лимит */
function svyazkaPochinit() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Разделитель определяем заново: если в памяти лежит неверный, починка им же и сломала бы формулы
  const sep = argSep(ss, true);
  const cells = ss.getSheets().map((sh) => sh.getRange('A1'));
  const was = cells.map((c) => c.getFormula());
  const work = [];
  for (let i = 0; i < cells.length; i++) {
    const at = parseFormula(was[i]);
    if (!at) continue;
    const now = sheetFormula(sep, at.url, at.name, at.rows, at.cols);
    if (was[i] !== now) work.push({ cell: cells[i], formula: now });
  }
  for (const w of work) w.cell.setFormula(w.formula);
  Logger.log('Разделитель аргументов: ' + sep + '\nВкладок: ' + cells.length + '\nПереписано формул: ' + work.length);
}

function colName(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** Размер вкладки под лист источника: занятая область с запасом, но не больше самого листа */
function sizeOf(sheet) {
  const rows = Math.min(sheet.getMaxRows(), Math.max(sheet.getLastRow(), 1) + ROWS_EXTRA);
  const cols = Math.min(sheet.getMaxColumns(), Math.max(sheet.getLastColumn(), 1) + COLS_EXTRA);
  return { rows: rows, cols: cols };
}

/** Привести вкладку к размеру: добавить недостающее, обрезать лишнее */
function fit(tab, rows, cols) {
  if (tab.getMaxRows() < rows) tab.insertRowsAfter(tab.getMaxRows(), rows - tab.getMaxRows());
  if (tab.getMaxRows() > rows) tab.deleteRows(rows + 1, tab.getMaxRows() - rows);
  if (tab.getMaxColumns() < cols) tab.insertColumnsAfter(tab.getMaxColumns(), cols - tab.getMaxColumns());
  if (tab.getMaxColumns() > cols) tab.deleteColumns(cols + 1, tab.getMaxColumns() - cols);
}

/** Очередь листов: сначала нужные ресурсу, затем остальные в порядке источников. Размеры здесь не считаем: это
    обращение к каждому листу источника, самая долгая часть, она делается только для тех листов, до которых дошли */
function buildQueue(bookOf, log) {
  const queue = [];
  for (let i = 0; i < SOURCES.length; i++) {
    const src = SOURCES[i];
    const required = REQUIRED[src.id] || [];
    for (const sheet of bookOf(src.id).getSheets()) {
      const name = sheet.getName();
      if (!src.take(name.trim())) {
        if (log) log.push('Не берём: ' + name);
        continue;
      }
      // title от обрезанного имени, name настоящее: лист с висячим пробелом не должен давать вкладку с пробелом,
      // иначе ресурс её не найдёт, а глазами разницы не видно
      queue.push({ srcIndex: i, name: name, title: name.trim(), required: required.indexOf(name.trim()) >= 0 });
    }
  }
  // Устойчивый порядок: нужные ресурсу вперёд, внутри групп порядок источников и листов сохраняется
  const order = queue.map((item, index) => ({ item: item, index: index }));
  order.sort((a, b) => Number(b.item.required) - Number(a.item.required) || a.index - b.index);
  return order.map((o) => o.item);
}

function linkAll() {
  runQueue(false);
}

/** Пересчитать размеры и формулы уже связанных вкладок: нужен, если источники выросли */
function svyazkaPereschet() {
  runQueue(true);
}

/** Начать очередь сначала и заново определить разделитель */
function svyazkaSbros() {
  const props = PropertiesService.getDocumentProperties();
  props.deleteProperty(cursorKey(false));
  props.deleteProperty(cursorKey(true));
  props.deleteProperty(SEP_KEY);
  Logger.log('Очередь начнётся сначала');
}

/** Место остановки у связывания и у пересчёта своё: иначе пересчёт доедет до конца по чужому курсору и скажет,
    что очередь пройдена, а первые вкладки останутся прежнего размера */
function cursorKey(force) {
  return force ? CURSOR_KEY + ':пересчёт' : CURSOR_KEY;
}

function runQueue(force) {
  const started = Date.now();
  const me = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getDocumentProperties();
  const log = [];
  const books = {};
  const bookOf = (id) => (books[id] = books[id] || SpreadsheetApp.openById(id));

  const sep = argSep(me);
  const key = cursorKey(force);
  const start = Number(props.getProperty(key) || 0);
  const queue = buildQueue(bookOf, start === 0 ? log : null);
  let cells = me.getSheets().reduce((s, sh) => s + sh.getMaxRows() * sh.getMaxColumns(), 0);
  log.push((force ? 'Пересчёт. ' : 'Связывание. ') + 'Листов в очереди: ' + queue.length + ', начинаем с ' + (start + 1));

  let missed = 0;
  let i = start;
  for (; i < queue.length; i++) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const item = queue[i];
    const src = SOURCES[item.srcIndex];
    const title = (src.prefix + item.title).slice(0, 99);
    let tab = me.getSheetByName(title);
    // Пропускаем вкладку, уже связанную формулой с правильным разделителем: это и есть главная экономия времени
    if (tab && !force && new RegExp('^=\\{?IMPORTRANGE\\("[^"]*"\\s*' + sep + '\\s*"', 'i').test(tab.getRange('A1').getFormula())) {
      log.push('Уже связан: ' + title);
      continue;
    }
    const sheet = bookOf(src.id).getSheetByName(item.name);
    if (!sheet) {
      log.push('Лист пропал в источнике: ' + item.name);
      missed++;
      continue;
    }
    const size = sizeOf(sheet);
    const before = tab ? tab.getMaxRows() * tab.getMaxColumns() : 0;
    const after = size.rows * size.cols;
    if (cells - before + after > CELL_LIMIT) {
      log.push('Не хватает места в таблице: ' + title + ' (' + size.rows + ' x ' + size.cols + ')');
      missed++;
      continue;
    }
    if (!tab) tab = me.insertSheet(title, me.getSheets().length);
    // Сначала убираем формулу: обрезать строки под живым разливом массива Google не даёт
    const cell = tab.getRange('A1');
    const had = cell.getFormula();
    if (had) cell.clearContent();
    fit(tab, size.rows, size.cols);
    cells += after - before;
    const url = 'https://docs.google.com/spreadsheets/d/' + src.id;
    const formula = sheetFormula(sep, url, item.name, size.rows, size.cols);
    cell.setFormula(formula);
    log.push((had ? 'Обновлён: ' : 'Связан: ') + title + ' (' + size.rows + ' x ' + size.cols + ')' + (item.required ? ', нужен ресурсу' : ''));
  }

  if (i >= queue.length) {
    props.deleteProperty(key);
    log.push(missed ? 'Очередь пройдена, но ' + missed + ' листов не связаны: разберите причины выше' : 'Очередь пройдена');
  } else {
    props.setProperty(key, String(i));
    log.push('Остановились на ' + i + ' из ' + queue.length + ': запустите ещё раз, продолжит с этого места');
  }
  log.push('Ячеек в таблице: ' + cells);
  Logger.log(log.join('\n'));
}
