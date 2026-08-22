// Продаж і заморозка абонементів (правила 3.4).

import { CONFIG } from './config.js';
import { STORES, put, getAll, getMeta, setMeta } from './db.js';
import { toISODate, daysUntilExpiry, EXPIRY_REMINDER_DAYS } from './access.js';
import { currentShiftId } from './shifts.js';

export const DEFAULT_TRAINER_PRICE = 400;

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
// method — оплата одним способом ('cash'/'card'); або cashAmount+cardAmount —
// оплата двома способами одночасно (частина готівкою, частина карткою), сума
// яких має точно дорівнювати tariff.price. Той самий принцип, що createReceipt
// у сестринському проєкті (Геркулес Шоп, mini_shop_POS/src/db.js).
export async function sellSubscription(client, tariff, { startDate, method, cashAmount, cardAmount, note = '' }) {
  const split = cashAmount != null || cardAmount != null;
  let cash, card;
  if (split) {
    cash = Math.round(Number(cashAmount) || 0);
    card = Math.round(Number(cardAmount) || 0);
    if (cash < 0 || card < 0) throw new Error('Суми оплати не можуть бути від\'ємними');
    if (cash + card !== tariff.price) {
      throw new Error(`Сума оплати (${cash + card} ₴) не збігається з ціною (${tariff.price} ₴)`);
    }
  } else {
    cash = method === 'card' ? 0 : tariff.price;
    card = method === 'card' ? tariff.price : 0;
  }

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
    // method лишається для сумісності зі старими записами/фільтрами — 'split',
    // коли оплата пройшла двома способами одночасно (див. cashAmount/cardAmount).
    method: cash > 0 && card > 0 ? 'split' : (card > 0 ? 'card' : 'cash'),
    cashAmount: cash,
    cardAmount: card,
    item: tariff.title,
    tariffId: tariff.id,
    note,
    shiftId: await currentShiftId() // для звіту чергування (shifts.js) — не блокує продаж, якщо зміни нема
  };
  await put(STORES.payments, payment);
  return payment;
}

// Виправлення вже проданого абонемента (помилка касира при продажу: не той
// тариф, дата, залишок візитів) — на відміну від Payment/Visit, підписка
// не історичний запис, а поточний стан клієнта, тому редагується напряму.
export async function editSubscription(client, { title, startDate, endDate, visitsTotal, visitsLeft }) {
  const sub = client.subscription;
  if (!sub) throw new Error('Немає абонемента');
  client.subscription = { ...sub, title, startDate, endDate, visitsTotal, visitsLeft };
  await put(STORES.clients, client);
  return client.subscription;
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

// Пакет персональних тренувань — окрема послуга поза клубним абонементом
// (client.subscription): не дає доступу в зал і не продовжує/замінює його,
// а лише рахує куплені/використані заняття з тренером. Ціна за заняття
// зберігається в meta (а не в CONFIG), щоб адміністратор міняв її з Налаштувань
// без правки коду; кількість занять щоразу вказується при продажу.
export async function getTrainerPrice() {
  return getMeta('trainerPrice', DEFAULT_TRAINER_PRICE);
}

export async function setTrainerPrice(price) {
  const p = Math.round(Number(price) || 0);
  if (p < 0) throw new Error('Ціна не може бути відʼємною');
  await setMeta('trainerPrice', p);
  return p;
}

// ── Реєстр тренерів ──
// Окремий стор (не client.type — той видалений): потрібен саме список імен
// для випадаючого списку при продажу занять і стабільний id для обліку зп
// (лог trainerSessions прив'язаний до id, а не до імені, щоб перейменування
// тренера не «губило» історію).
export async function getTrainers() {
  return getAll(STORES.trainers);
}

export async function addTrainer(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('Вкажіть імʼя тренера');
  const trainer = { id: crypto.randomUUID(), name: trimmed, archivedAt: null, createdAt: new Date().toISOString() };
  await put(STORES.trainers, trainer);
  return trainer;
}

async function requireTrainer(id) {
  const trainers = await getAll(STORES.trainers);
  const trainer = trainers.find((t) => t.id === id);
  if (!trainer) throw new Error('Тренера не знайдено');
  return trainer;
}

export async function renameTrainer(id, name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('Вкажіть імʼя тренера');
  const trainer = await requireTrainer(id);
  const updated = { ...trainer, name: trimmed };
  await put(STORES.trainers, updated);
  return updated;
}

export async function setTrainerArchived(id, archived) {
  const trainer = await requireTrainer(id);
  const updated = { ...trainer, archivedAt: archived ? new Date().toISOString() : null };
  await put(STORES.trainers, updated);
  return updated;
}

// Скільки занять кожен тренер провів за місяць (monthISO 'YYYY-MM') — джерело
// для розрахунку зарплати (TrainersScreen.jsx). Рахується з логу trainerSessions
// (пишеться в markTrainerSessionUsed), а не з покупок — оплачені наперед заняття
// зараховуються тренеру лише коли фактично проведені.
export async function getTrainerMonthlyStats(monthISO = new Date().toISOString().slice(0, 7)) {
  const [trainers, log] = await Promise.all([getAll(STORES.trainers), getAll(STORES.trainerSessions)]);
  return trainers
    .map((t) => ({ ...t, count: log.filter((l) => l.trainerId === t.id && l.date.slice(0, 7) === monthISO).length }))
    .sort((a, b) => a.name.localeCompare(b.name, 'uk'));
}

// Продаж: якщо пакет уже є, нові заняття додаються до залишку (а не заміняють
// його) — на відміну від sellSubscription, де новий тариф заміняє попередній.
// trainerId — обов'язково: до якого конкретно тренера куплено заняття
// (у пулі показується останній; ім'я в оплаті (item) лишається назавжди).
export async function sellTrainerPackage(client, { sessions, pricePerSession, trainerId, method, cashAmount, cardAmount, note = '' }) {
  const count = Math.round(Number(sessions));
  if (!count || count < 1) throw new Error('Вкажіть кількість тренувань (мінімум 1)');
  if (!trainerId) throw new Error('Оберіть тренера');
  const trainer = await requireTrainer(trainerId);
  const perSession = Math.round(Number(pricePerSession) || 0);
  const total = perSession * count;

  const split = cashAmount != null || cardAmount != null;
  let cash, card;
  if (split) {
    cash = Math.round(Number(cashAmount) || 0);
    card = Math.round(Number(cardAmount) || 0);
    if (cash < 0 || card < 0) throw new Error('Суми оплати не можуть бути від\'ємними');
    if (cash + card !== total) {
      throw new Error(`Сума оплати (${cash + card} ₴) не збігається з ціною (${total} ₴)`);
    }
  } else {
    cash = method === 'card' ? 0 : total;
    card = method === 'card' ? total : 0;
  }

  const existing = client.trainerPackage;
  client.trainerPackage = {
    sessionsTotal: (existing?.sessionsTotal || 0) + count,
    sessionsLeft: (existing?.sessionsLeft || 0) + count,
    pricePerSession: perSession,
    trainerId: trainer.id,
    trainerName: trainer.name,
    purchasedAt: new Date().toISOString()
  };
  await put(STORES.clients, client);

  const payment = {
    id: crypto.randomUUID(),
    clientId: client.id,
    date: new Date().toISOString(),
    amount: total,
    method: cash > 0 && card > 0 ? 'split' : (card > 0 ? 'card' : 'cash'),
    cashAmount: cash,
    cardAmount: card,
    item: `Тренер ${trainer.name} (${count} трен. × ${fmtMoneyPlain(perSession)} ₴)`,
    note,
    shiftId: await currentShiftId()
  };
  await put(STORES.payments, payment);
  return payment;
}

function fmtMoneyPlain(n) {
  return Math.round(Number(n) || 0).toLocaleString('uk-UA');
}

// Відмітка одного використаного заняття (тренер провів заняття з клієнтом) —
// пише запис у trainerSessions (лог для зп, getTrainerMonthlyStats), окремо
// від зменшення залишку в пулі клієнта.
export async function markTrainerSessionUsed(client) {
  const pkg = client.trainerPackage;
  if (!pkg) throw new Error('Немає пакету тренувань');
  if (pkg.sessionsLeft <= 0) throw new Error('Тренування вичерпано');
  client.trainerPackage = { ...pkg, sessionsLeft: pkg.sessionsLeft - 1 };
  await put(STORES.clients, client);
  if (pkg.trainerId) {
    await put(STORES.trainerSessions, {
      id: crypto.randomUUID(),
      trainerId: pkg.trainerId,
      trainerName: pkg.trainerName,
      clientId: client.id,
      clientName: client.name,
      date: new Date().toISOString()
    });
  }
  return client.trainerPackage;
}

// Виправлення пакету касиром (та сама логіка, що editSubscription).
export async function editTrainerPackage(client, { sessionsTotal, sessionsLeft, pricePerSession, trainerId }) {
  const pkg = client.trainerPackage;
  if (!pkg) throw new Error('Немає пакету тренувань');
  let trainerName = pkg.trainerName;
  if (trainerId && trainerId !== pkg.trainerId) {
    trainerName = (await requireTrainer(trainerId)).name;
  }
  client.trainerPackage = { ...pkg, sessionsTotal, sessionsLeft, pricePerSession, trainerId, trainerName };
  await put(STORES.clients, client);
  return client.trainerPackage;
}

// Клієнти, чий абонемент закінчується найближчими днями — список для дзвінків
// адміністратора (нагадування при скануванні картки в DeskScreen і банер
// «Всіх сповіщено» після відкриття зміни). Найближчі за терміном — першими.
export async function getExpiringSoonClients(days = EXPIRY_REMINDER_DAYS, now = new Date()) {
  const clients = await getAll(STORES.clients);
  return clients
    .filter((c) => c.type === 'member' && !c.archivedAt)
    .map((c) => ({ client: c, daysLeft: daysUntilExpiry(c, now) }))
    .filter(({ daysLeft }) => daysLeft !== null && daysLeft <= days)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .map(({ client, daysLeft }) => ({
      id: client.id,
      name: client.name,
      phone: client.phone,
      endDate: client.subscription.endDate,
      daysLeft
    }));
}

// Банер нагадування на стійці прив'язаний до конкретної зміни (не до дня чи
// глобально) — нова зміна завжди починається з видимим нагадуванням, навіть
// якщо список тих самих клієнтів не змінився з учора.
export async function isExpiryReminderDismissed(shiftId) {
  if (!shiftId) return true;
  return (await getMeta('expiryReminderDismissedShiftId')) === shiftId;
}

export function dismissExpiryReminder(shiftId) {
  return setMeta('expiryReminderDismissedShiftId', shiftId);
}

export const FREEZE_REASONS = {
  service: 'На службі',
  injury: 'Травма',
  other: 'Інше'
};
