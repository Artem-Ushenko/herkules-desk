// Життєвий цикл візиту: вхід, вихід, скасування входу.
// Візит списується на вході (правило 3.2) — люди йдуть не відмічаючись.

import { CONFIG } from './config.js';
import { STORES, get, put, remove, getAllByIndex } from './db.js';
import { currentShiftId } from './shifts.js';

export function listOpenVisits() {
  return getAllByIndex(STORES.visits, 'open', 1);
}

export async function findOpenVisit(clientId) {
  const open = await getAllByIndex(STORES.visits, 'clientId', clientId);
  return open.find(v => v.checkOut === null) || null;
}

function hasCountedVisits(client) {
  return client.type === 'member' && client.subscription && client.subscription.visitsLeft !== null;
}

export async function checkIn(client) {
  const visit = {
    id: crypto.randomUUID(),
    clientId: client.id,
    checkIn: Date.now(),
    checkOut: null,
    open: 1,
    autoClosed: false,
    subscriptionTitle: client.subscription ? client.subscription.title : '',
    clientType: client.type,
    shiftId: await currentShiftId() // для звіту чергування (shifts.js) — не блокує вхід, якщо зміни нема
  };
  await put(STORES.visits, visit);
  if (hasCountedVisits(client)) {
    client.subscription.visitsLeft -= 1;
    await put(STORES.clients, client);
  }
  return visit;
}

export async function checkOut(visit) {
  visit.checkOut = Date.now();
  delete visit.open;
  await put(STORES.visits, visit);
  return visit;
}

// Чи ще діє вікно «Скасувати вхід» без режиму адміністратора
export function withinUndoWindow(visit, now = Date.now()) {
  return now - visit.checkIn <= CONFIG.UNDO_WINDOW_MIN * 60000;
}

// Скасування входу: візит видаляється (не сторнується — він ще «не відбувся»),
// списаний візит повертається на баланс. Після вікна — тільки з логуванням.
export async function cancelCheckIn(visit, { adminOverride = false } = {}) {
  if (!withinUndoWindow(visit) && !adminOverride) {
    throw new Error('Вікно скасування минуло — потрібен режим адміністратора');
  }
  await remove(STORES.visits, visit.id);
  const client = await get(STORES.clients, visit.clientId);
  if (client && hasCountedVisits(client)) {
    client.subscription.visitsLeft += 1;
    await put(STORES.clients, client);
  }
  if (adminOverride) {
    await logAdminAction('cancel-visit', { visitId: visit.id, clientId: visit.clientId, checkIn: visit.checkIn });
  }
}

// Журнал дій адміністратора поза звичайним потоком (вимога 3.2)
async function logAdminAction(action, details) {
  const log = (await get(STORES.meta, 'adminLog'))?.value || [];
  log.push({ at: new Date().toISOString(), action, details });
  await put(STORES.meta, { key: 'adminLog', value: log });
}

// Автозакриття о CLOSE_TIME (правило 3.5): «хто зараз у залі» має бути
// правдивим, вчорашні привиди неприпустимі. Межа закриття рахується від
// календарного дня входу — так само коректно закриває і сьогоднішні
// відкриті візити, і ті, що лишились відкритими з минулих сеансів роботи
// застосунку (наприклад, якщо міні-ПК був вимкнений опівночі).
function closeBoundary(checkInTs) {
  const [h, m] = CONFIG.CLOSE_TIME.split(':').map(Number);
  const d = new Date(checkInTs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).getTime();
}

export async function autoCloseStaleVisits(now = Date.now()) {
  const open = await listOpenVisits();
  let closed = 0;
  for (const v of open) {
    if (now >= closeBoundary(v.checkIn)) {
      // Тривалість не рахується — checkOut лишається null (правило 3.5)
      v.checkOut = null;
      v.autoClosed = true;
      delete v.open;
      await put(STORES.visits, v);
      closed++;
    }
  }
  return closed;
}
