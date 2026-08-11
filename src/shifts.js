// Зміни (чергування адміністратора/рецепціоніста) — облік і звітність.
//
// НЕ гейт і НЕ каса: DeskScreen (допуск за карткою) працює завжди, незалежно
// від того, чи відкрита зміна. Фізична каса й рахунок готівки — у
// сестринському проєкті (Геркулес Шоп, той самий стек); тут лише прив'язка
// Payment/Visit до того, хто чергував, і зведений звіт при закритті — хто,
// коли, скільки візитів і оплат (готівка/картка) відбулось за цей час.

import { CONFIG } from './config.js';
import { STORES, getAll, getAllByIndex, put, getMeta, setMeta } from './db.js';

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

// Підсумок зміни: візити й оплати, прив'язані до неї за shiftId (currentShiftId()
// у visits.js/subscriptions.js виставляє це поле в момент створення запису).
async function summarize(shift) {
  const [visits, payments] = await Promise.all([
    getAllByIndex(STORES.visits, 'shiftId', shift.id),
    getAllByIndex(STORES.payments, 'shiftId', shift.id)
  ]);
  const cashTotal = payments.filter((p) => p.method === 'cash').reduce((sum, p) => sum + p.amount, 0);
  const cardTotal = payments.filter((p) => p.method === 'card').reduce((sum, p) => sum + p.amount, 0);
  return {
    visitCount: visits.length,
    paymentCount: payments.length,
    cashTotal,
    cardTotal,
    total: cashTotal + cardTotal
  };
}

async function closeRecord(shift, closedBy) {
  const stats = await summarize(shift);
  const closed = { ...shift, closedAt: Date.now(), closedBy, ...stats };
  await put(STORES.shifts, closed);
  return closed;
}

// Відкриває зміну. Якщо існує незакрита стара зміна (забули закрити) —
// спочатку закриває її від імені системи. Повертає { shift, autoClosed }.
export async function openShift(staff) {
  const name = (staff ?? '').trim();
  if (!name) throw new Error('Вкажіть, хто відкриває зміну');

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
    cashTotal: 0,
    cardTotal: 0,
    total: 0
  };
  await put(STORES.shifts, shift);
  return { shift, autoClosed };
}

export async function closeCurrentShift(closedBy = 'staff') {
  const open = await getCurrentShift();
  if (!open) return null;
  return closeRecord(open, closedBy);
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
