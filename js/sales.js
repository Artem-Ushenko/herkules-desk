// Екран «Продажі»: оплати за період, номер фіскального чека, сторно, CSV.
// Історичні записи не редагуються (розділ 2): виправлення — сторнуючим
// записом; вручну дозаповнюється лише номер чека Checkbox.

import { STORES, get, getAll, put } from './db.js';
import { toISODate } from './access.js';
import { h, fmtMoney, fmtDateTime, downloadCSV, armedButton } from './ui.js';

let root;
let from, to;

export function initSales(container) {
  root = container;
  const now = new Date();
  from = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  to = toISODate(now);
}

export async function onShowSales() {
  const [payments, clients] = await Promise.all([getAll(STORES.payments), getAll(STORES.clients)]);
  const names = new Map(clients.map(c => [c.id, c.name]));

  const visible = payments
    .filter(p => { const d = p.date.slice(0, 10); return d >= from && d <= to; })
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = visible.reduce((sum, p) => sum + p.amount, 0);

  root.innerHTML = '';
  root.appendChild(h('div', { class: 'toolbar' }, [
    h('label', {}, ['З: ', h('input', { type: 'date', value: from, onchange: (e) => { from = e.target.value; onShowSales(); } })]),
    h('label', {}, ['По: ', h('input', { type: 'date', value: to, onchange: (e) => { to = e.target.value; onShowSales(); } })]),
    h('span', { class: 'spacer' }),
    h('b', {}, 'Разом: ' + fmtMoney(total)),
    h('button', {
      onclick: () => downloadCSV(`продажі-${from}-${to}.csv`, [
        ['Дата', 'Клієнт', 'Позиція', 'Сума', 'Спосіб', '№ чека', 'Нотатка'],
        ...visible.map(p => [fmtDateTime(p.date), names.get(p.clientId) || p.clientId, p.item,
          p.amount, p.method === 'cash' ? 'готівка' : 'картка', p.fiscalReceiptNo || '', p.note || ''])
      ])
    }, 'Експорт CSV')
  ]));

  root.appendChild(h('table', { class: 'data-table' }, [
    h('thead', {}, h('tr', {}, ['Дата', 'Клієнт', 'Позиція', 'Сума', 'Спосіб', '№ фіск. чека', ''].map(t => h('th', {}, t)))),
    h('tbody', {}, visible.map(p => h('tr', {}, [
      h('td', {}, fmtDateTime(p.date)),
      h('td', {}, h('a', { href: '#clients/' + p.clientId }, names.get(p.clientId) || p.clientId)),
      h('td', {}, p.item + (p.note ? ` (${p.note})` : '')),
      h('td', { class: p.amount < 0 ? 'status-deny' : '' }, fmtMoney(p.amount)),
      h('td', {}, p.method === 'cash' ? 'готівка' : 'картка'),
      h('td', {}, fiscalCell(p)),
      h('td', {}, p.amount > 0 && !p.note.startsWith('сторно') ? stornoButton(p) : '')
    ])))
  ]));
  if (!visible.length) root.appendChild(h('p', { class: 'stub' }, 'Оплат за період немає'));
}

// Номер чека Checkbox вводиться вручну після фіскалізації — єдине поле,
// яке можна дозаповнити в історичному записі
function fiscalCell(p) {
  if (p.fiscalReceiptNo) return p.fiscalReceiptNo;
  const input = h('input', { class: 'fiscal-input', placeholder: '№ чека' });
  const save = h('button', { class: 'small', onclick: async () => {
    if (!input.value.trim()) return;
    p.fiscalReceiptNo = input.value.trim();
    await put(STORES.payments, p);
    onShowSales();
  } }, '✓');
  return h('span', { class: 'inline-form' }, [input, save]);
}

function stornoButton(p) {
  return armedButton('Сторно', 'Створити сторнуючий запис?', async () => {
    await put(STORES.payments, {
      id: crypto.randomUUID(),
      clientId: p.clientId,
      date: new Date().toISOString(),
      amount: -p.amount,
      method: p.method,
      item: p.item,
      tariffId: p.tariffId,
      fiscalReceiptNo: '',
      note: 'сторно ' + p.id.slice(0, 8)
    });
    onShowSales();
  });
}
