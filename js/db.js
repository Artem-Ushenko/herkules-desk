// Шар IndexedDB: схема, міграції, CRUD.
// База локальна і єдина; жодних зовнішніх сервісів (розділ 1 специфікації).

export const DB_NAME = 'herkules';
export const DB_VERSION = 1;

export const STORES = {
  clients: 'clients',
  visits: 'visits',
  payments: 'payments',
  tariffs: 'tariffs',
  meta: 'meta' // службові записи: лічильник карток, handle папки бекапів, журнал дій адміністратора
};

let dbPromise = null;

// Міграції за версіями: switch без break — оновлення з будь-якої старої версії
// проходить усі наступні кроки. Нова версія схеми = новий case + інкремент DB_VERSION.
function migrate(db, oldVersion) {
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
    }
  }
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => migrate(req.result, e.oldVersion);
    req.onsuccess = () => {
      const db = req.result;
      // Якщо інша вкладка оновить схему — закриваємось, щоб не блокувати її
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('База заблокована іншою вкладкою'));
  });
  return dbPromise;
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDB();
  const tx = db.transaction(storeName, mode);
  const result = await fn(tx.objectStore(storeName));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ── CRUD ──

export function get(store, id) {
  return withStore(store, 'readonly', (s) => requestToPromise(s.get(id)));
}

export function getAll(store) {
  return withStore(store, 'readonly', (s) => requestToPromise(s.getAll()));
}

export function getAllByIndex(store, indexName, value) {
  return withStore(store, 'readonly', (s) => requestToPromise(s.index(indexName).getAll(value)));
}

export function put(store, record) {
  return withStore(store, 'readwrite', (s) => requestToPromise(s.put(record)));
}

export function remove(store, id) {
  return withStore(store, 'readwrite', (s) => requestToPromise(s.delete(id)));
}

export function clear(store) {
  return withStore(store, 'readwrite', (s) => requestToPromise(s.clear()));
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
  const [clients, visits, payments, tariffs] = await Promise.all([
    getAll(STORES.clients),
    getAll(STORES.visits),
    getAll(STORES.payments),
    getAll(STORES.tariffs)
  ]);
  return {
    format: 'herkules-backup',
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    cardCounter: await getMeta('cardCounter', 0),
    clients, visits, payments, tariffs
  };
}

// Заміна бази вмістом знімка (відновлення з бекапу)
export async function importSnapshot(snap) {
  if (snap.format !== 'herkules-backup') throw new Error('Це не файл бекапу Геркулеса');
  for (const store of [STORES.clients, STORES.visits, STORES.payments, STORES.tariffs]) {
    await clear(store);
  }
  for (const c of snap.clients) await put(STORES.clients, c);
  for (const v of snap.visits) await put(STORES.visits, v);
  for (const p of snap.payments) await put(STORES.payments, p);
  for (const t of snap.tariffs) await put(STORES.tariffs, t);
  await setMeta('cardCounter', snap.cardCounter || 0);
}
