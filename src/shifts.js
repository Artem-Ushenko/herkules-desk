// Зміни (чергування адміністратора/рецепціоніста) — облік і звітність.
//
// Гейт допуску (ShiftGate.jsx/App.jsx): поки зміну не відкрито явно, стійка
// (допуск за карткою) не рендериться — «хто на зміні» запитується перед
// стартом роботи. Прив'язка Payment/Visit до того, хто чергував, і зведений
// звіт при закритті — хто, коли, скільки візитів і оплат (готівка/картка)
// відбулось за цей час.
//
// Перерахунок готівки — той самий принцип, що в сестринському проєкті
// (Геркулес Шоп, mini_shop_POS/src/db.js: openShift/closeShiftLocal):
// openingCash фіксується на вході, expectedCash = openingCash + готівковий
// виторг рахується при закритті, countedCash — те, що фактично нарахував
// той, хто закриває. Δ (розбіжність) видно в Налаштуваннях і в Telegram-звіті
// (cloud.js). Автозакриття системою (забули закрити) countedCash не питає —
// лишається null, як і в Шопі.

import { CONFIG } from './config.js';
import { STORES, getAll, getAllByIndex, put, getMeta, setMeta } from './db.js';
import { trySendReport, formatShiftCloseReport } from './cloud.js';

export async function getCurrentShift() {
  const all = await getAll(STORES.shifts);
  return all.find((s) => !s.closedAt) || null;
}

export async function getStaffList() {
  return getMeta('staffList', []);
}

export async function addStaffName(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('Вкажіть ім\'я');
  const list = await getStaffList();
  if (list.includes(trimmed)) return list;
  const updated = [...list, trimmed];
  await setMeta('staffList', updated);
  return updated;
}

export async function renameStaffName(oldName, newName) {
  const trimmed = (newName ?? '').trim();
  if (!trimmed) throw new Error('Вкажіть ім\'я');
  const list = await getStaffList();
  if (trimmed !== oldName && list.includes(trimmed)) throw new Error('Такий співробітник вже є');
  const updated = list.map((n) => (n === oldName ? trimmed : n));
  await setMeta('staffList', updated);
  return updated;
}

export async function removeStaffName(name) {
  const list = await getStaffList();
  const updated = list.filter((n) => n !== name);
  await setMeta('staffList', updated);
  return updated;
}

// Підсумок зміни: візити й оплати, прив'язані до неї за shiftId (currentShiftId()
// у visits.js/subscriptions.js виставляє це поле в момент створення запису).
// Експортується окремо від closeRecord, щоб екран закриття міг показати
// попередній підсумок (і очікувану готівку) ще ДО фактичного закриття зміни.
export async function summarize(shift) {
  const [visits, payments] = await Promise.all([
    getAllByIndex(STORES.visits, 'shiftId', shift.id),
    getAllByIndex(STORES.payments, 'shiftId', shift.id)
  ]);
  // cashAmount/cardAmount — платежі після впровадження розділеної оплати;
  // старі записи (лише method+amount) рахуються цілком одним способом.
  const cashTotal = payments.reduce((sum, p) => sum + (p.cashAmount ?? (p.method === 'cash' ? p.amount : 0)), 0);
  const cardTotal = payments.reduce((sum, p) => sum + (p.cardAmount ?? (p.method === 'card' ? p.amount : 0)), 0);
  return {
    visitCount: visits.length,
    paymentCount: payments.length,
    cashTotal,
    cardTotal,
    total: cashTotal + cardTotal
  };
}

async function closeRecord(shift, closedBy, countedCash = null) {
  const stats = await summarize(shift);
  const expectedCash = (shift.openingCash ?? 0) + stats.cashTotal;
  const closed = {
    ...shift,
    closedAt: Date.now(),
    closedBy,
    ...stats,
    expectedCash,
    countedCash: countedCash === null ? null : Math.round(Number(countedCash) || 0)
  };
  await put(STORES.shifts, closed);
  // Звіт у Telegram (cloud.js) — best effort, не чекаємо і не блокуємо закриття
  // зміни. Єдина точка виклику охоплює всі шляхи закриття: явне, автозакриття
  // о CLOSE_TIME і автозакриття забутої зміни при відкритті нової.
  trySendReport(formatShiftCloseReport(closed));
  return closed;
}

// Відкриває зміну. Якщо існує незакрита стара зміна (забули закрити) —
// спочатку закриває її від імені системи. Повертає { shift, autoClosed }.
// openingCash — розмінна готівка в касі на початку зміни (₴).
export async function openShift(staff, openingCash = 0) {
  const name = (staff ?? '').trim();
  if (!name) throw new Error('Вкажіть, хто відкриває зміну');
  const opening = Math.round(Number(openingCash) || 0);
  if (opening < 0) throw new Error('Розмінна готівка не може бути від\'ємною');

  const stale = await getCurrentShift();
  const autoClosed = stale ? await closeRecord(stale, 'system') : null;

  const shift = {
    id: crypto.randomUUID(),
    staff: name,
    openedAt: Date.now(),
    closedAt: null,
    closedBy: null,
    visitCount: 0,
    paymentCount: 0,
    openingCash: opening,
    cashTotal: 0,
    cardTotal: 0,
    countedCash: null,
    expectedCash: null,
    total: 0
  };
  await put(STORES.shifts, shift);
  return { shift, autoClosed };
}

// countedCash — готівка, яку фактично нарахували в касі при закритті (null —
// перерахунок не проводився, напр. автозакриття системою).
export async function closeCurrentShift(closedBy = 'staff', countedCash = null) {
  const open = await getCurrentShift();
  if (!open) return null;
  return closeRecord(open, closedBy, countedCash);
}

// Прив'язка нового Payment/Visit до відкритої зміни (checkIn()/sellSubscription()) —
// немає відкритої зміни, shiftId лишається undefined, створення запису це не блокує.
export async function currentShiftId() {
  const shift = await getCurrentShift();
  return shift ? shift.id : undefined;
}

// Автозакриття о CLOSE_TIME — той самий принцип і та сама межа доби, що для
// візитів (visits.js: closeBoundary), щоб «хто чергував сьогодні» не тягнулось
// у наступний робочий день.
function closeBoundary(openedAt) {
  const [h, m] = CONFIG.CLOSE_TIME.split(':').map(Number);
  const d = new Date(openedAt);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).getTime();
}

export async function autoCloseStaleShift(now = Date.now()) {
  const open = await getCurrentShift();
  if (!open || now < closeBoundary(open.openedAt)) return null;
  return closeRecord(open, 'system');
}

// Останні N закритих змін (найновіші перші) — для звіту в Налаштуваннях.
export async function getRecentClosedShifts(limit = 10) {
  const all = await getAll(STORES.shifts);
  return all
    .filter((s) => s.closedAt)
    .sort((a, b) => b.closedAt - a.closedAt)
    .slice(0, limit);
}
