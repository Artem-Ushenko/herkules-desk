// Екран «Клієнти»: реєстр із фільтрами і картка клієнта.
// Маршрути: #clients — список, #clients/HC0001 — картка.

import { CONFIG } from './config.js';
import { STORES, get, getAll, getAllByIndex, put, remove, nextCardId } from './db.js';
import { evaluateAccess, formatDate, toISODate } from './access.js';
import { listOpenVisits } from './visits.js';
import { sellSubscription, freezeSubscription, unfreezeSubscription, freezeAllowance, FREEZE_REASONS } from './subscriptions.js';
import { barcodeSVG } from './barcode.js';
import { qrSVG } from './qr.js';
import { h, fmtMoney, fmtDateTime, downloadCSV, armedButton } from './ui.js';

const TYPE_LABELS = { member: 'Клієнт', guest: 'Гість орендаря', trainer: 'Тренер' };

let root;
let filter = 'all';
let search = '';

export function initClients(container) {
  root = container;
}

export function onShowClients(param) {
  if (param === 'new') renderForm(null);
  else if (param) renderCard(param);
  else renderList();
}

// ════════ Список ════════

const FILTERS = {
  all: 'Усі',
  active: 'Активні',
  expiring: 'Спливають',
  expired: 'Прострочені',
  veterans: 'Ветерани',
  guests: 'Гості орендаря',
  ingym: 'Зараз у залі',
  archived: 'Архів'
};

async function renderList() {
  const [clients, open] = await Promise.all([getAll(STORES.clients), listOpenVisits()]);
  const inGymIds = new Set(open.map(v => v.clientId));

  const visible = clients.filter(c => {
    if (filter !== 'archived' && c.archivedAt) return false;
    const d = () => evaluateAccess(c);
    switch (filter) {
      case 'active': return c.type === 'member' && d().allow;
      case 'expiring': return c.type === 'member' && d().level === 'warn';
      case 'expired': return c.type === 'member' && !d().allow;
      case 'veterans': return c.isVeteran;
      case 'guests': return c.type === 'guest';
      case 'ingym': return inGymIds.has(c.id);
      case 'archived': return !!c.archivedAt;
      default: return true;
    }
  }).filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.id.toLowerCase().includes(q);
  }).sort((a, b) => a.name.localeCompare(b.name, 'uk'));

  root.innerHTML = '';
  root.appendChild(h('div', { class: 'toolbar' }, [
    h('input', {
      class: 'search', placeholder: 'Пошук: імʼя / телефон / картка', value: search,
      oninput: (e) => { search = e.target.value; renderList(); }
    }),
    h('select', {
      onchange: (e) => { filter = e.target.value; renderList(); }
    }, Object.entries(FILTERS).map(([k, label]) =>
      h('option', { value: k, selected: k === filter }, label))),
    h('a', { class: 'btn btn-primary', href: '#clients/new' }, '+ Додати клієнта'),
    h('button', { onclick: () => exportClientsCSV(visible, false) }, 'Експорт CSV'),
    // Меднотатки — дані про здоровʼя: окрема кнопка з попередженням (розділ 8)
    armedButton('Експорт із меднотатками', '⚠ Це чутливі дані про здоровʼя — точно?', () => exportClientsCSV(visible, true))
  ]));

  const rows = visible.map(c => {
    const st = subStatus(c);
    return h('tr', { onclick: () => { location.hash = '#clients/' + c.id; } }, [
      h('td', { class: 'mono' }, c.id),
      h('td', {}, [
        h('b', {}, c.name),
        c.isVeteran ? h('span', { class: 'badge vet' }, 'ветеран') : null,
        c.medicalNotes ? h('span', { class: 'badge med', title: 'Є медичні нотатки' }, '⚕') : null
      ]),
      h('td', {}, c.phone),
      h('td', {}, TYPE_LABELS[c.type]),
      h('td', { class: 'status-' + st.level }, st.text),
      h('td', {}, inGymIds.has(c.id) ? '🟢 у залі' : '')
    ]);
  });

  root.appendChild(h('table', { class: 'data-table' }, [
    h('thead', {}, h('tr', {}, ['Картка', 'Імʼя', 'Телефон', 'Тип', 'Абонемент', ''].map(t => h('th', {}, t)))),
    h('tbody', {}, rows)
  ]));
  if (!visible.length) root.appendChild(h('p', { class: 'stub' }, 'Нікого не знайдено'));
}

function subStatus(c) {
  if (c.type !== 'member') return { text: '—', level: 'none' };
  if (!c.subscription) return { text: 'Немає', level: 'deny' };
  const d = evaluateAccess(c);
  const s = c.subscription;
  if (s.freeze.active) return { text: `Заморожено з ${formatDate(s.freeze.since)}`, level: 'warn' };
  if (!d.allow) return { text: d.reason, level: 'deny' };
  const visits = s.visitsLeft === null ? 'безліміт' : s.visitsLeft + ' візит(и)';
  return { text: `до ${formatDate(s.endDate)} · ${visits}`, level: d.level === 'warn' ? 'warn' : 'ok' };
}

function exportClientsCSV(clients, withMedical) {
  const head = ['Картка', 'Імʼя', 'Телефон', 'Тип', 'Ветеран', 'Дата народження', 'Згода з', 'Абонемент', 'Діє до', 'Візитів'];
  if (withMedical) head.push('Медичні нотатки');
  const rows = [head];
  for (const c of clients) {
    const r = [c.id, c.name, c.phone, TYPE_LABELS[c.type], c.isVeteran ? 'так' : '', c.birthday,
      formatDate(c.consentAt?.slice(0, 10)), c.subscription?.title || '', formatDate(c.subscription?.endDate || ''),
      c.subscription ? (c.subscription.visitsLeft ?? 'безліміт') : ''];
    if (withMedical) r.push(c.medicalNotes);
    rows.push(r);
  }
  downloadCSV(withMedical ? 'клієнти-з-меднотатками.csv' : 'клієнти.csv', rows);
}

// ════════ Картка клієнта ════════

async function renderCard(id) {
  const client = await get(STORES.clients, id);
  if (!client) return renderForm(null, id); // невідомий номер — одразу форма з цією карткою

  const [visits, payments, tariffs] = await Promise.all([
    getAllByIndex(STORES.visits, 'clientId', id),
    getAllByIndex(STORES.payments, 'clientId', id),
    getAll(STORES.tariffs)
  ]);
  visits.sort((a, b) => b.checkIn - a.checkIn);
  payments.sort((a, b) => b.date.localeCompare(a.date));

  root.innerHTML = '';
  root.appendChild(h('div', { class: 'card-head' }, [
    h('a', { href: '#clients', class: 'btn' }, '← Реєстр'),
    h('h1', {}, [client.name + ' ', h('span', { class: 'mono muted' }, client.id)]),
    h('span', { class: 'badge' }, TYPE_LABELS[client.type]),
    client.isVeteran ? h('span', { class: 'badge vet' }, 'ветеран') : null,
    client.archivedAt ? h('span', { class: 'badge med' }, 'в архіві') : null,
    h('span', { class: 'spacer' }),
    h('button', { onclick: () => printCard(client) }, '🖨 Друк картки'),
    h('a', { class: 'btn', href: '#clients/' + id + '/edit', onclick: (e) => { e.preventDefault(); renderForm(client); } }, 'Редагувати')
  ]));

  // Медичні нотатки — ПЕРШИМИ: тренер має побачити обмеження до заняття (5.2)
  root.appendChild(h('div', { class: 'medical' + (client.medicalNotes ? ' has-notes' : '') }, [
    h('b', {}, '⚕ Медичні нотатки: '),
    client.medicalNotes || 'немає'
  ]));

  if (!client.consentAt) {
    root.appendChild(h('div', { class: 'banner warn-banner' }, [
      '⚠ Згоду на обробку персональних даних не зафіксовано — обовʼязково до першого візиту. ',
      h('button', { class: 'btn-primary', onclick: async () => {
        client.consentAt = new Date().toISOString();
        await put(STORES.clients, client);
        renderCard(id);
      } }, 'Зафіксувати згоду')
    ]));
  }

  const grid = h('div', { class: 'card-grid' });
  root.appendChild(grid);

  // ── Абонемент ──
  const subBox = h('div', { class: 'box' });
  grid.appendChild(subBox);
  subBox.appendChild(h('h2', {}, 'Абонемент'));
  const s = client.subscription;
  if (client.type !== 'member') {
    subBox.appendChild(h('p', { class: 'muted' }, client.type === 'guest'
      ? 'Гість орендаря: платить напряму тренеру, абонемент не потрібен, гроші не проходять через клуб.'
      : 'Тренер-орендар: доступ без абонемента.'));
  } else if (s) {
    const d = evaluateAccess(client);
    subBox.appendChild(h('div', { class: 'sub-info status-' + (s.freeze.active || !d.allow ? 'deny' : d.level) }, [
      h('div', { class: 'sub-title' }, s.title),
      h('div', {}, `Діє: ${formatDate(s.startDate)} — ${formatDate(s.endDate)}`),
      h('div', {}, s.visitsLeft === null ? 'Безліміт' : `Візитів: ${s.visitsLeft} з ${s.visitsTotal}`),
      s.freeze.active
        ? h('div', {}, `❄ Заморожено з ${formatDate(s.freeze.since)} (${FREEZE_REASONS[s.freeze.reason]})`)
        : h('div', { class: 'muted' }, `Заморозка: використано ${s.freeze.daysUsed} з ${CONFIG.MAX_FREEZE_DAYS} дн. (служба — без ліміту)`)
    ]));

    if (s.freeze.active) {
      subBox.appendChild(h('button', { class: 'btn-primary', onclick: async () => {
        const days = await unfreezeSubscription(client);
        alertBox(subBox, `Розморожено, термін подовжено на ${days} дн.`);
        renderCard(id);
      } }, '☀ Розморозити'));
    } else {
      const reasonSel = h('select', {}, Object.entries(FREEZE_REASONS).map(([k, v]) => h('option', { value: k }, v)));
      subBox.appendChild(h('div', { class: 'inline-form' }, [
        reasonSel,
        h('button', { onclick: async () => {
          try {
            await freezeSubscription(client, reasonSel.value);
            renderCard(id);
          } catch (err) { alertBox(subBox, err.message, true); }
        } }, '❄ Заморозити')
      ]));
    }
  } else {
    subBox.appendChild(h('p', { class: 'muted' }, 'Немає абонемента'));
  }

  // Продаж — тільки для клієнтів клубу: гроші гостей не проходять через клуб (розділ 0)
  if (client.type === 'member') {
    subBox.appendChild(h('h3', {}, s ? 'Продати новий' : 'Продати абонемент'));
    if (!tariffs.length) {
      subBox.appendChild(h('p', { class: 'muted' }, ['Немає тарифів — додайте у ', h('a', { href: '#settings' }, 'Налаштуваннях')]));
    } else {
      const available = tariffs.filter(t => !t.forVeterans || client.isVeteran);
      const tariffSel = h('select', {}, available.map(t =>
        h('option', { value: t.id }, `${t.title} — ${fmtMoney(t.price)} (${t.visits ?? 'безліміт'} віз., ${t.days} дн.)`)));
      const methodSel = h('select', {}, [h('option', { value: 'cash' }, 'Готівка'), h('option', { value: 'card' }, 'Картка')]);
      const startInput = h('input', { type: 'date', value: toISODate(new Date()) });
      const fiscalInput = h('input', { type: 'text', placeholder: '№ чека Checkbox (можна пізніше)' });
      subBox.appendChild(h('div', { class: 'sell-form' }, [
        tariffSel, methodSel,
        h('label', {}, ['Початок: ', startInput]),
        fiscalInput,
        h('button', { class: 'btn-primary', onclick: async () => {
          const tariff = available.find(t => t.id === tariffSel.value);
          if (!tariff) return;
          await sellSubscription(client, tariff, {
            startDate: startInput.value, method: methodSel.value, fiscalReceiptNo: fiscalInput.value.trim()
          });
          renderCard(id);
        } }, 'Продати')
      ]));
    }
  }

  // ── Історія ──
  const histBox = h('div', { class: 'box' });
  grid.appendChild(histBox);
  histBox.appendChild(h('h2', {}, `Візити (${visits.length})`));
  histBox.appendChild(h('table', { class: 'data-table compact' }, [
    h('tbody', {}, visits.slice(0, 15).map(v => h('tr', {}, [
      h('td', {}, fmtDateTime(v.checkIn)),
      h('td', {}, v.checkOut ? '→ ' + new Date(v.checkOut).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' }) : 'у залі'),
      h('td', {}, v.autoClosed ? h('span', { class: 'badge med' }, 'автозакрито') : ''),
      h('td', { class: 'muted' }, v.subscriptionTitle)
    ])))
  ]));

  histBox.appendChild(h('h2', {}, `Оплати (${payments.length})`));
  histBox.appendChild(h('table', { class: 'data-table compact' }, [
    h('tbody', {}, payments.slice(0, 15).map(p => h('tr', {}, [
      h('td', {}, fmtDateTime(p.date)),
      h('td', {}, p.item),
      h('td', { class: p.amount < 0 ? 'status-deny' : '' }, fmtMoney(p.amount)),
      h('td', { class: 'muted' }, p.method === 'cash' ? 'готівка' : 'картка')
    ])))
  ]));

  // ── Небезпечна зона ──
  const danger = h('div', { class: 'box danger-zone' });
  root.appendChild(danger);
  danger.appendChild(client.archivedAt
    ? h('button', { onclick: async () => { client.archivedAt = null; await put(STORES.clients, client); renderCard(id); } }, 'Повернути з архіву')
    : h('button', { onclick: async () => { client.archivedAt = new Date().toISOString(); await put(STORES.clients, client); renderCard(id); } }, 'В архів'));
  // Повне видалення разом з історією — вимога розділу 8 про персональні дані
  danger.appendChild(armedButton('Видалити назавжди', '⚠ Видалити клієнта і ВСЮ історію? Це незворотно', async () => {
    for (const v of visits) await remove(STORES.visits, v.id);
    for (const p of payments) await remove(STORES.payments, p.id);
    await remove(STORES.clients, id);
    location.hash = '#clients';
  }));
}

function alertBox(container, message, isError = false) {
  const el = h('div', { class: 'banner ' + (isError ? 'warn-banner' : 'ok-banner') }, message);
  container.prepend(el);
  setTimeout(() => el.remove(), 4000);
}

// ════════ Анкета (нова / редагування) ════════

async function renderForm(client, presetId = '') {
  const isNew = !client;
  const c = client || {
    id: presetId, type: 'member', name: '', phone: '', birthday: '', isVeteran: false,
    medicalNotes: '', consentAt: '', hostTrainerId: '', createdAt: '', archivedAt: null, subscription: null
  };
  const trainers = (await getAll(STORES.clients)).filter(x => x.type === 'trainer' && !x.archivedAt);

  root.innerHTML = '';
  root.appendChild(h('div', { class: 'card-head' }, [
    h('a', { href: isNew ? '#clients' : '#clients/' + c.id, class: 'btn' }, '← Назад'),
    h('h1', {}, isNew ? 'Новий клієнт' : 'Редагування: ' + c.name)
  ]));

  const idInput = h('input', { type: 'text', value: c.id, disabled: !isNew, placeholder: 'авто' });
  const typeSel = h('select', {}, Object.entries(TYPE_LABELS).map(([k, v]) => h('option', { value: k, selected: c.type === k }, v)));
  const nameInput = h('input', { type: 'text', value: c.name, required: true });
  const phoneInput = h('input', { type: 'tel', value: c.phone });
  const bdayInput = h('input', { type: 'date', value: c.birthday });
  const vetInput = h('input', { type: 'checkbox', checked: c.isVeteran });
  const medInput = h('textarea', { value: c.medicalNotes, rows: 3, placeholder: 'Травми, обмеження — напр., «грижа L4–L5, без осьового навантаження»' });
  const consentInput = h('input', { type: 'checkbox', checked: !!c.consentAt });
  const hostSel = h('select', {}, [
    h('option', { value: '' }, '— оберіть тренера —'),
    ...trainers.map(t => h('option', { value: t.id, selected: c.hostTrainerId === t.id }, t.name))
  ]);
  const hostRow = h('label', { class: 'form-row', hidden: c.type !== 'guest' }, ['До кого прийшов', hostSel]);
  typeSel.addEventListener('change', () => { hostRow.hidden = typeSel.value !== 'guest'; });

  const form = h('form', { class: 'edit-form' }, [
    h('label', { class: 'form-row' }, ['Номер картки', idInput]),
    h('label', { class: 'form-row' }, ['Тип', typeSel]),
    h('label', { class: 'form-row' }, ['Імʼя та прізвище *', nameInput]),
    h('label', { class: 'form-row' }, ['Телефон', phoneInput]),
    h('label', { class: 'form-row' }, ['Дата народження', bdayInput]),
    h('label', { class: 'form-row check' }, [vetInput, ' Ветеран']),
    h('label', { class: 'form-row' }, ['⚕ Медичні нотатки', medInput]),
    hostRow,
    h('label', { class: 'form-row check' }, [consentInput, ' Згоду на обробку персональних даних підписано']),
    h('button', { class: 'btn-primary', type: 'submit' }, isNew ? 'Створити' : 'Зберегти')
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let id = idInput.value.trim().toUpperCase();
    if (isNew) {
      if (!id) id = await nextCardId(CONFIG.CARD_PREFIX);
      else if (await get(STORES.clients, id)) {
        alertBox(root, `Картка ${id} вже зайнята`, true);
        return;
      }
    } else {
      id = c.id;
    }
    const updated = {
      ...c,
      id,
      type: typeSel.value,
      name: nameInput.value.trim(),
      phone: phoneInput.value.trim(),
      birthday: bdayInput.value,
      isVeteran: vetInput.checked,
      medicalNotes: medInput.value.trim(),
      consentAt: consentInput.checked ? (c.consentAt || new Date().toISOString()) : '',
      hostTrainerId: typeSel.value === 'guest' ? hostSel.value : '',
      createdAt: c.createdAt || new Date().toISOString()
    };
    await put(STORES.clients, updated);
    location.hash = '#clients/' + id;
    renderCard(id);
  });

  root.appendChild(form);
}

// ════════ Друк клубної картки 86×54 мм (розділ 7) ════════

function printCard(client) {
  const area = document.getElementById('print-area');
  area.innerHTML = `
    <div class="club-card">
      <div class="cc-club">${CONFIG.CLUB_NAME}</div>
      <div class="cc-name"></div>
      <div class="cc-barcode">${barcodeSVG(CONFIG.BARCODE_TYPE, client.id, { height: 46 })}</div>
      <div class="cc-number">${client.id}</div>
      <div class="cc-qr">${qrSVG(client.id)}</div>
      <div class="cc-address">${CONFIG.CLUB_ADDRESS}</div>
    </div>
  `;
  area.querySelector('.cc-name').textContent = client.name;
  window.print();
}
