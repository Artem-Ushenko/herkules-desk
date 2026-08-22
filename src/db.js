// Шар IndexedDB: схема, міграції, CRUD. Через обгортку idb (як у сестринському
// проєкті — Геркулес Шоп), контракт функцій той самий, що й у vanilla-версії.
// База локальна і єдина; жодних зовнішніх сервісів (розділ 1 специфікації).

import { openDB as idbOpenDB } from 'idb';

export const DB_NAME = 'herkules';
export const DB_VERSION = 3;

export const STORES = {
  clients: 'clients',
  visits: 'visits',
  payments: 'payments',
  tariffs: 'tariffs',
  shifts: 'shifts', // чергування адміністратора/рецепціоніста — облік/звітність, БЕЗ каси (розділ shifts.js)
  meta: 'meta', // службові записи: лічильник карток, handle папки бекапів, журнал дій адміністратора
  trainers: 'trainers', // реєстр тренерів — для вибору при продажу персональних занять
  trainerSessions: 'trainerSessions' // лог проведених персональних тренувань — облік для зп тренерів (TrainersScreen.jsx)
};

// Дозволені причини скасування оплати — той самий список, що й у сестринському
// проєкті (Геркулес Шоп), щоб причина мала однаковий сенс в обох застосунках.
export const CANCEL_REASONS = ['помилка', 'повернення', 'виправлення'];

let dbPromise = null;

// Міграції за версіями: switch без break — оновлення з будь-якої старої версії
// проходить усі наступні кроки. Нова версія схеми = новий case + інкремент DB_VERSION.
function migrate(db, oldVersion, transaction) {
  switch (oldVersion) {
    case 0: {
      db.createObjectStore(STORES.clients, { keyPath: 'id' });

      const visits = db.createObjectStore(STORES.visits, { keyPath: 'id' });
      visits.createIndex('clientId', 'clientId');
      visits.createIndex('checkIn', 'checkIn');
      // Відкриті візити позначаються полем open=1; при виході поле видаляється,
      // і запис зникає з індексу — «хто в залі» читається одним запитом
      visits.createIndex('open', 'open');

      const payments = db.createObjectStore(STORES.payments, { keyPath: 'id' });
      payments.createIndex('clientId', 'clientId');
      payments.createIndex('date', 'date');

      db.createObjectStore(STORES.tariffs, { keyPath: 'id' });
      db.createObjectStore(STORES.meta, { keyPath: 'key' });
      // falls through — нова БД (oldVersion 0) отримує й наступні кроки одразу
    }
    // v2: зміни чергування (shifts.js). shiftId на visits/payments — необов'язкове
    // поле (записи без відкритої зміни просто не потрапляють в індекс), тому
    // старі записи з БД v1 лишаються валідними без міграції даних.
    case 1: {
      db.createObjectStore(STORES.shifts, { keyPath: 'id' });
      transaction.objectStore(STORES.visits).createIndex('shiftId', 'shiftId');
      transaction.objectStore(STORES.payments).createIndex('shiftId', 'shiftId');
      // falls through
    }
    // v3: облік тренерів (subscriptions.js: sellTrainerPackage/markTrainerSessionUsed) —
    // реєстр тренерів + лог проведених персональних занять (для зп, TrainersScreen.jsx)
    case 2: {
      db.createObjectStore(STORES.trainers, { keyPath: 'id' });
      const trainerSessions = db.createObjectStore(STORES.trainerSessions, { keyPath: 'id' });
      trainerSessions.createIndex('trainerId', 'trainerId');
    }
  }
}

export function openDB() {
  if (dbPromise) return dbPromise;
  let rejectBlocked;
  const blockedPromise = new Promise((_, reject) => { rejectBlocked = reject; });
  const idbPromise = idbOpenDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      migrate(db, oldVersion, transaction);
    },
    // Якщо інша вкладка оновить схему — закриваємось, щоб не блокувати її
    blocking() {
      idbPromise.then((db) => db.close());
    },
    blocked() {
      rejectBlocked(new Error('База заблокована іншою вкладкою'));
    }
  });
  dbPromise = Promise.race([idbPromise, blockedPromise]);
  return dbPromise;
}

// ── CRUD ──

export async function get(store, id) {
  const db = await openDB();
  return db.get(store, id);
}

export async function getAll(store) {
  const db = await openDB();
  return db.getAll(store);
}

export async function getAllByIndex(store, indexName, value) {
  const db = await openDB();
  return db.getAllFromIndex(store, indexName, value);
}

export async function put(store, record) {
  const db = await openDB();
  return db.put(store, record);
}

export async function remove(store, id) {
  const db = await openDB();
  return db.delete(store, id);
}

export async function clear(store) {
  const db = await openDB();
  return db.clear(store);
}

// ── Службове ──

export async function getMeta(key, fallback = null) {
  const rec = await get(STORES.meta, key);
  return rec ? rec.value : fallback;
}

export function setMeta(key, value) {
  return put(STORES.meta, { key, value });
}

// Наступний номер картки: HC0001, HC0002… Лічильник у meta,
// щоб видалення клієнта не звільняло його номер.
export async function nextCardId(prefix) {
  const n = (await getMeta('cardCounter', 0)) + 1;
  await setMeta('cardCounter', n);
  return prefix + String(n).padStart(4, '0');
}

// Повний знімок бази для бекапу (розділ 6)
export async function exportSnapshot() {
  const [clients, visits, payments, tariffs, shifts, trainers, trainerSessions] = await Promise.all([
    getAll(STORES.clients),
    getAll(STORES.visits),
    getAll(STORES.payments),
    getAll(STORES.tariffs),
    getAll(STORES.shifts),
    getAll(STORES.trainers),
    getAll(STORES.trainerSessions)
  ]);
  return {
    format: 'herkules-backup',
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    cardCounter: await getMeta('cardCounter', 0),
    staffList: await getMeta('staffList', []),
    clients, visits, payments, tariffs, shifts, trainers, trainerSessions
  };
}

// Заміна бази вмістом знімка (відновлення з бекапу)
export async function importSnapshot(snap) {
  if (snap.format !== 'herkules-backup') throw new Error('Це не файл бекапу Геркулеса');
  for (const store of [STORES.clients, STORES.visits, STORES.payments, STORES.tariffs, STORES.shifts, STORES.trainers, STORES.trainerSessions]) {
    await clear(store);
  }
  for (const c of snap.clients) await put(STORES.clients, c);
  for (const v of snap.visits) await put(STORES.visits, v);
  for (const p of snap.payments) await put(STORES.payments, p);
  for (const t of snap.tariffs) await put(STORES.tariffs, t);
  // v1-бекапи (до появи чергувань) не мають shifts/staffList, v2 — trainers/trainerSessions;
  // старіші файли приймаються як порожні
  for (const s of snap.shifts || []) await put(STORES.shifts, s);
  for (const t of snap.trainers || []) await put(STORES.trainers, t);
  for (const l of snap.trainerSessions || []) await put(STORES.trainerSessions, l);
  await setMeta('cardCounter', snap.cardCounter || 0);
  await setMeta('staffList', snap.staffList || []);
}
