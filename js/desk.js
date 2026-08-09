// Екран стійки: сканування, вердикт, «у залі зараз», скасування входу.
// Один скан — перемикач: немає в залі → вхід, є в залі → вихід (розділ 5.1).

import { CONFIG } from './config.js';
import { STORES, get, put } from './db.js';
import { evaluateAccess } from './access.js';
import { checkIn, checkOut, cancelCheckIn, findOpenVisit, listOpenVisits, withinUndoWindow } from './visits.js';

const TYPE_LABELS = { member: 'Клієнт', guest: 'Гість орендаря', trainer: 'Тренер' };

let root, verdictEl, scanInput, gridEl, countEl;
let lastCheckIn = null; // останній вхід — для кнопки «Скасувати вхід»

export function focusScan() {
  if (scanInput) scanInput.focus();
}

export function initDesk(container) {
  root = container;
  root.innerHTML = `
    <div class="verdict" id="verdict"></div>
    <div class="scan-row">
      <input id="scan-input" placeholder="Скануйте картку або введіть номер…" autocomplete="off" spellcheck="false">
    </div>
    <div class="in-gym">
      <h2>У залі зараз (<span id="in-gym-count">0</span>)</h2>
      <div class="in-gym-grid" id="in-gym-grid"></div>
    </div>
  `;
  verdictEl = root.querySelector('#verdict');
  scanInput = root.querySelector('#scan-input');
  gridEl = root.querySelector('#in-gym-grid');
  countEl = root.querySelector('#in-gym-count');

  scanInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && scanInput.value.trim()) {
      handleScan(scanInput.value);
      scanInput.value = '';
    }
  });

  renderIdle();
  refreshInGym();
  // Тривалість «скільки вже в залі» оновлюється раз на пів хвилини
  setInterval(refreshInGym, 30000);
  // Автозакриття (app.js) міняє список візитів поза скануванням — оновити одразу
  document.addEventListener('herkules:visits-changed', refreshInGym);
}

// ── Обробка сканування ──

async function handleScan(rawCode) {
  const code = rawCode.trim().toUpperCase();
  const client = await get(STORES.clients, code);

  if (!client) return renderUnknown(code);
  if (client.archivedAt) return renderVerdict('deny', 'СТОП', `${client.name} — картка в архіві`);

  const open = await findOpenVisit(client.id);
  if (open) {
    const v = await checkOut(open);
    await refreshInGym();
    return renderVerdict('ok', 'ДО ПОБАЧЕННЯ', `${client.name} · у залі ${formatDuration(v.checkOut - v.checkIn)}`);
  }

  const decision = evaluateAccess(client);
  if (!decision.allow) {
    renderVerdict('deny', 'СТОП', decision.reason, [
      sellButton(client.id)
    ], client.name);
    return;
  }

  const visit = await checkIn(client);
  lastCheckIn = { visit, clientName: client.name };
  await refreshInGym();

  const subInfo = visitBalanceText(client);
  if (decision.level === 'warn') {
    renderVerdict('warn', 'ПРОХОДЬ ⚠', `${client.name} · ${decision.reason}`, [undoButton()]);
  } else {
    const sub = client.type === 'member' ? subInfo : TYPE_LABELS[client.type];
    renderVerdict('ok', 'ПРОХОДЬ', `${client.name}${sub ? ' · ' + sub : ''}`, [undoButton()]);
  }
}

function visitBalanceText(client) {
  const s = client.subscription;
  if (!s) return '';
  if (s.visitsLeft === null) return s.title;
  return `${s.title} · лишилось ${s.visitsLeft} візит(и)`;
}

// ── Вердикт ──

function renderIdle() {
  verdictEl.className = 'verdict';
  verdictEl.innerHTML = `
    <div class="v-title">Скануйте картку</div>
    <div class="v-hint">Сканер працює як клавіатура: код + Enter</div>
  `;
}

function renderVerdict(level, title, sub, actions = [], name = '') {
  verdictEl.className = 'verdict ' + level;
  verdictEl.innerHTML = '';
  if (name) {
    const n = document.createElement('div');
    n.className = 'v-sub';
    n.textContent = name;
    verdictEl.appendChild(n);
  }
  const t = document.createElement('div');
  t.className = 'v-title';
  t.textContent = title;
  verdictEl.appendChild(t);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'v-sub';
    s.textContent = sub;
    verdictEl.appendChild(s);
  }
  if (actions.length) {
    const a = document.createElement('div');
    a.className = 'v-actions';
    for (const btn of actions) a.appendChild(btn);
    verdictEl.appendChild(a);
  }
}

function sellButton(clientId) {
  const b = document.createElement('a');
  b.className = 'btn btn-primary';
  b.href = '#clients/' + clientId;
  b.textContent = 'Продати абонемент';
  return b;
}

// «Скасувати вхід»: у межах вікна — одразу; пізніше — другим кліком
// як дія адміністратора з логуванням (правило 3.2)
function undoButton() {
  const b = document.createElement('button');
  b.textContent = 'Скасувати вхід';
  let armedAdmin = false;
  b.addEventListener('click', async () => {
    if (!lastCheckIn) return;
    const inWindow = withinUndoWindow(lastCheckIn.visit);
    if (!inWindow && !armedAdmin) {
      armedAdmin = true;
      b.textContent = 'Минуло понад ' + CONFIG.UNDO_WINDOW_MIN + ' хв — натисніть ще раз (дія залогується)';
      b.classList.add('btn-danger');
      return;
    }
    await cancelCheckIn(lastCheckIn.visit, { adminOverride: !inWindow });
    renderVerdict('ok', 'ВХІД СКАСОВАНО', `${lastCheckIn.clientName} · візит повернуто на баланс`);
    lastCheckIn = null;
    await refreshInGym();
    focusScan();
  });
  return b;
}

// ── Невідома картка: створити клієнта з цим номером (розділ 5.1) ──

function renderUnknown(code) {
  renderVerdict('deny', 'НЕВІДОМА КАРТКА', code);
  const form = document.createElement('form');
  form.className = 'mini-form';
  form.innerHTML = `
    <label>Створити клієнта з карткою <b>${code}</b>:</label>
    <input type="text" name="name" placeholder="Імʼя та прізвище" required>
    <input type="tel" name="phone" placeholder="Телефон" required>
    <label class="consent">
      <input type="checkbox" name="consent" required>
      <span>Згоду на обробку персональних даних підписано (обовʼязково до першого візиту)</span>
    </label>
    <button type="submit" class="btn-primary">Створити клієнта</button>
  `;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const client = {
      id: code,
      type: 'member',
      name: data.get('name').trim(),
      phone: data.get('phone').trim(),
      birthday: '',
      isVeteran: false,
      medicalNotes: '',
      consentAt: new Date().toISOString(),
      hostTrainerId: '',
      createdAt: new Date().toISOString(),
      archivedAt: null,
      subscription: null
    };
    await put(STORES.clients, client);
    renderVerdict('warn', 'СТВОРЕНО', `${client.name} · без абонемента`, [sellButton(client.id)]);
    focusScan();
  });
  verdictEl.appendChild(form);
}

// ── У залі зараз ──

async function refreshInGym() {
  const open = await listOpenVisits();
  open.sort((a, b) => b.checkIn - a.checkIn);
  countEl.textContent = open.length;
  gridEl.innerHTML = '';
  const now = Date.now();
  for (const v of open) {
    const client = await get(STORES.clients, v.clientId);
    const tile = document.createElement('div');
    tile.className = 'person-tile';
    const time = new Date(v.checkIn).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' });
    tile.innerHTML = `
      <div class="p-name"></div>
      <div class="p-meta">зайшов о ${time} · у залі ${formatDuration(now - v.checkIn)}</div>
      <span class="p-type ${v.clientType}">${TYPE_LABELS[v.clientType] || v.clientType}</span>
    `;
    tile.querySelector('.p-name').textContent = client ? client.name : v.clientId;
    gridEl.appendChild(tile);
  }
}

function formatDuration(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} хв`;
  return `${Math.floor(min / 60)} год ${min % 60} хв`;
}
