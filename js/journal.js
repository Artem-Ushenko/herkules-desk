// Екран «Журнал»: усі візити з фільтрами, автозакриті — з позначкою, CSV.

import { CONFIG } from './config.js';
import { STORES, getAll } from './db.js';
import { toISODate } from './access.js';
import { h, fmtDateTime, downloadCSV } from './ui.js';

let root;
let from, to, clientQuery = '';

export function initJournal(container) {
  root = container;
  from = to = toISODate(new Date());
}

// Межа доби у звітах (3.6): доба = [OPEN_TIME, CLOSE_TIME]. Візит,
// що почався до OPEN_TIME, належить попередньому дню.
export function businessDate(ts) {
  const d = new Date(ts);
  const hhmm = d.toTimeString().slice(0, 5);
  if (hhmm < CONFIG.OPEN_TIME) d.setDate(d.getDate() - 1);
  return toISODate(d);
}

export async function onShowJournal() {
  const [visits, clients] = await Promise.all([getAll(STORES.visits), getAll(STORES.clients)]);
  const names = new Map(clients.map(c => [c.id, c.name]));

  const visible = visits.filter(v => {
    const d = businessDate(v.checkIn);
    if (d < from || d > to) return false;
    if (clientQuery) {
      const q = clientQuery.toLowerCase();
      const name = (names.get(v.clientId) || '').toLowerCase();
      if (!name.includes(q) && !v.clientId.toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => b.checkIn - a.checkIn);

  const autoClosed = visible.filter(v => v.autoClosed).length;

  root.innerHTML = '';
  root.appendChild(h('div', { class: 'toolbar' }, [
    h('label', {}, ['З: ', h('input', { type: 'date', value: from, onchange: (e) => { from = e.target.value; onShowJournal(); } })]),
    h('label', {}, ['По: ', h('input', { type: 'date', value: to, onchange: (e) => { to = e.target.value; onShowJournal(); } })]),
    h('input', {
      class: 'search', placeholder: 'Клієнт або картка', value: clientQuery,
      oninput: (e) => { clientQuery = e.target.value; onShowJournal(); }
    }),
    h('span', { class: 'spacer' }),
    h('span', { class: 'muted' }, `Візитів: ${visible.length}` + (autoClosed ? ` · автозакритих: ${autoClosed}` : '')),
    h('button', {
      onclick: () => downloadCSV(`журнал-${from}-${to}.csv`, [
        ['День', 'Вхід', 'Вихід', 'Тривалість', 'Клієнт', 'Картка', 'Тип', 'Абонемент', 'Автозакрито'],
        ...visible.map(v => [businessDate(v.checkIn), fmtDateTime(v.checkIn),
          v.checkOut ? fmtDateTime(v.checkOut) : '', duration(v), names.get(v.clientId) || '', v.clientId,
          v.clientType, v.subscriptionTitle, v.autoClosed ? 'так' : ''])
      ])
    }, 'Експорт CSV')
  ]));

  root.appendChild(h('table', { class: 'data-table' }, [
    h('thead', {}, h('tr', {}, ['Вхід', 'Вихід', 'Тривалість', 'Клієнт', 'Тип', 'Абонемент'].map(t => h('th', {}, t)))),
    h('tbody', {}, visible.map(v => h('tr', {}, [
      h('td', {}, fmtDateTime(v.checkIn)),
      // Автозакриті — показник дисципліни сканування, підсвічуються окремо (3.5)
      h('td', {}, v.autoClosed
        ? h('span', { class: 'badge med' }, 'автозакрито 23:00')
        : (v.checkOut ? new Date(v.checkOut).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' }) : h('span', { class: 'status-ok' }, 'у залі'))),
      h('td', {}, duration(v)),
      h('td', {}, h('a', { href: '#clients/' + v.clientId }, names.get(v.clientId) || v.clientId)),
      h('td', {}, v.clientType === 'member' ? 'клієнт' : v.clientType === 'guest' ? 'гість' : 'тренер'),
      h('td', { class: 'muted' }, v.subscriptionTitle)
    ])))
  ]));
  if (!visible.length) root.appendChild(h('p', { class: 'stub' }, 'Візитів за період немає'));
}

// Тривалість автозакритих не рахується (3.5) — чесніше «—», ніж вигадане число
function duration(v) {
  if (v.autoClosed || !v.checkOut) return '—';
  const min = Math.round((v.checkOut - v.checkIn) / 60000);
  return min < 60 ? `${min} хв` : `${Math.floor(min / 60)} год ${min % 60} хв`;
}
