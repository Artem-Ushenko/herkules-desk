// Продаж і заморозка абонементів (правила 3.4).

import { CONFIG } from './config.js';
import { STORES, put } from './db.js';
import { toISODate } from './access.js';
import { currentShiftId } from './shifts.js';

export function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function daysBetween(aISO, bISO) {
  return Math.round((Date.parse(bISO) - Date.parse(aISO)) / 86400000);
}

// Продаж: абонемент замінюється, оплата пишеться один раз і назавжди.
// endDate = start + days - 1: тариф на 30 днів діє 30 календарних днів включно.
export async function sellSubscription(client, tariff, { startDate, method, note = '' }) {
  client.subscription = {
    tariffId: tariff.id,
    title: tariff.title,
    startDate,
    endDate: addDays(startDate, tariff.days - 1),
    visitsTotal: tariff.visits,
    visitsLeft: tariff.visits,
    freeze: { active: false, since: null, reason: null, daysUsed: 0 }
  };
  await put(STORES.clients, client);
  const payment = {
    id: crypto.randomUUID(),
    clientId: client.id,
    date: new Date().toISOString(),
    amount: tariff.price,
    method,
    item: tariff.title,
    tariffId: tariff.id,
    note,
    shiftId: await currentShiftId() // для звіту чергування (shifts.js) — не блокує продаж, якщо зміни нема
  };
  await put(STORES.payments, payment);
  return payment;
}

// Скільки днів заморозки ще доступно (для причин, крім служби)
export function freezeAllowance(sub) {
  return CONFIG.MAX_FREEZE_DAYS - (sub.freeze.daysUsed || 0);
}

export async function freezeSubscription(client, reason) {
  const sub = client.subscription;
  if (!sub) throw new Error('Немає абонемента');
  if (sub.freeze.active) throw new Error('Абонемент уже заморожено');
  if (reason !== 'service' && freezeAllowance(sub) <= 0) {
    throw new Error(`Ліміт заморозки (${CONFIG.MAX_FREEZE_DAYS} дн.) вичерпано`);
  }
  sub.freeze.active = true;
  sub.freeze.since = toISODate(new Date());
  sub.freeze.reason = reason;
  await put(STORES.clients, client);
}

// Розморозка: endDate подовжується на зараховані дні.
// Служба — без ліміту (ветеранська умова); інші причини — в межах MAX_FREEZE_DAYS
// сумарно на абонемент, дні понад ліміт не зараховуються.
export async function unfreezeSubscription(client) {
  const sub = client.subscription;
  if (!sub || !sub.freeze.active) throw new Error('Абонемент не заморожено');
  const frozenDays = Math.max(daysBetween(sub.freeze.since, toISODate(new Date())), 0);
  const credited = sub.freeze.reason === 'service'
    ? frozenDays
    : Math.min(frozenDays, freezeAllowance(sub));
  sub.endDate = addDays(sub.endDate, credited);
  if (sub.freeze.reason !== 'service') sub.freeze.daysUsed += credited;
  sub.freeze.active = false;
  sub.freeze.since = null;
  sub.freeze.reason = null;
  await put(STORES.clients, client);
  return credited;
}

export const FREEZE_REASONS = {
  service: 'На службі',
  injury: 'Травма',
  other: 'Інше'
};
