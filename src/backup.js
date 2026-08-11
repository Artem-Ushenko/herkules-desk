// Бекап через File System Access API (розділ 6). Датовані знімки в папку,
// синхронізовану Google Drive for Desktop. Ніякого Google API й токенів —
// диск G: це звичайна тека на файловій системі.

import { CONFIG } from './config.js';
import { STORES, get, put, exportSnapshot, importSnapshot } from './db.js';

const HANDLE_KEY = 'backupDirHandle';
const FILE_RE = /^herkules-\d{4}-\d{2}-\d{2}-\d{4}\.json$/;

let dirHandle = null;
let timer = null;
let statusListeners = [];

// ── Стан для індикатора в шапці ──

let state = { configured: false, permissionOk: false, lastBackupAt: null, lastError: null };

function emit() {
  for (const fn of statusListeners) fn(state);
}

// Повертає функцію відписки — виклик кожен раз, коли перебудовується екран,
// інакше слухачі накопичуються, поки застосунок працює годинами (PWA не перезавантажується)
export function onStatusChange(fn) {
  statusListeners.push(fn);
  fn(state);
  return () => { statusListeners = statusListeners.filter(l => l !== fn); };
}

// ── Ініціалізація при старті (розділ 6, крок 2) ──

export async function initBackup() {
  state.lastBackupAt = await get(STORES.meta, 'lastBackupAt').then(r => r?.value || null);
  const rec = await get(STORES.meta, HANDLE_KEY);
  if (!rec || !rec.value) {
    state.configured = false;
    emit();
    return;
  }
  dirHandle = rec.value;
  state.configured = true;
  // queryPermission не потребує жесту користувача — можна перевірити одразу
  const perm = await dirHandle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied');
  state.permissionOk = perm === 'granted';
  emit();
  if (state.permissionOk) startSchedule();
  bindAutoReconfirm();
}

// Chrome скидає дозвіл readwrite на збережений FileSystemDirectoryHandle при
// кожному новому запуску браузера (кіоск перезапускає --app щодня) —
// queryPermission() одразу після старту повертає не 'granted', навіть якщо
// дозвіл уже надавали раніше. requestPermission() у відповідь на той самий
// дозвіл зазвичай не показує діалог повторно (Chrome тихо підтверджує вже
// наданий сайту дозвіл) — але вимагає жесту користувача, тож ловимо кожен
// клік будь-де в застосунку (відкриття зміни на гейті теж підходить) і, поки
// дозволу нема, тихо перевіряємо — без походу в Налаштування. Слухач лишається
// на весь час роботи (не once): диск може відпасти й відновитись і посеред дня.
let lastAutoReconfirmAt = 0;
let autoReconfirmBound = false;
function bindAutoReconfirm() {
  if (autoReconfirmBound) return;
  autoReconfirmBound = true;
  document.addEventListener('click', async () => {
    if (state.permissionOk || !dirHandle) return;
    const now = Date.now();
    if (now - lastAutoReconfirmAt < 30000) return;
    lastAutoReconfirmAt = now;
    await reconfirmPermission();
  });
}

// ── Вибір / перевидача папки (потребує жесту користувача — виклик з onclick) ──

export async function pickFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  dirHandle = handle;
  await put(STORES.meta, { key: HANDLE_KEY, value: handle });
  state.configured = true;
  state.permissionOk = true;
  state.lastError = null;
  emit();
  startSchedule();
  await writeBackup();
}

export async function reconfirmPermission() {
  if (!dirHandle) return pickFolder();
  const perm = await dirHandle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
  state.permissionOk = perm === 'granted';
  emit();
  if (state.permissionOk) startSchedule();
  return state.permissionOk;
}

// ── Запис бекапу ──

function pad2(n) { return String(n).padStart(2, '0'); }

function backupFilename(d = new Date()) {
  return `herkules-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.json`;
}

export async function writeBackup() {
  if (!dirHandle) return { ok: false, reason: 'not-configured' };
  try {
    const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      state.permissionOk = false;
      emit();
      return { ok: false, reason: 'no-permission' };
    }
    const snapshot = await exportSnapshot();
    const fileHandle = await dirHandle.getFileHandle(backupFilename(), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(snapshot, null, 2));
    await writable.close();

    await rotate();

    const at = Date.now();
    await put(STORES.meta, { key: 'lastBackupAt', value: at });
    state.lastBackupAt = at;
    state.lastError = null;
    state.permissionOk = true;
    emit();
    return { ok: true };
  } catch (err) {
    state.lastError = err.message;
    // Втрата доступу до теки (видалили, відʼєднали диск) — не блокує роботу (розділ 6)
    if (err.name === 'NotAllowedError' || err.name === 'NotFoundError') state.permissionOk = false;
    emit();
    return { ok: false, reason: err.message };
  }
}

// Зберігаються останні BACKUP_KEEP файлів — зіпсований знімок не має затерти попередні
async function rotate() {
  const names = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file' && FILE_RE.test(name)) names.push(name);
  }
  names.sort(); // формат імені сортується лексикографічно = хронологічно
  const excess = names.length - CONFIG.BACKUP_KEEP;
  for (let i = 0; i < excess; i++) {
    await dirHandle.removeEntry(names[i]).catch(() => {});
  }
}

// ── Розклад: інтервал + закриття вкладки (розділ 6, крок 3) ──

function startSchedule() {
  if (timer) clearInterval(timer);
  timer = setInterval(writeBackup, CONFIG.BACKUP_INTERVAL_MIN * 60000);
}

let unloadBound = false;
export function bindUnloadBackup() {
  if (unloadBound) return;
  unloadBound = true;
  // visibilitychange надійніший за beforeunload для асинхронного запису
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') writeBackup();
  });
  window.addEventListener('pagehide', () => writeBackup());
}

// ── Відновлення з файлу (розділ 6) ──

export async function readBackupFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data.format !== 'herkules-backup') throw new Error('Це не файл бекапу Геркулеса');
  return data;
}

export async function restoreFromSnapshot(data) {
  await importSnapshot(data);
}

export function formatStatus(s) {
  if (!s.configured) return { text: 'Копія: не налаштовано', stale: true };
  if (!s.permissionOk) return { text: 'Копія: немає доступу до папки', stale: true };
  if (!s.lastBackupAt) return { text: 'Копія: ще не робилась', stale: true };

  const ageMin = (Date.now() - s.lastBackupAt) / 60000;
  const staleAfter = CONFIG.BACKUP_INTERVAL_MIN * 2; // подвійний інтервал без бекапу — вже проблема
  const d = new Date(s.lastBackupAt);
  const time = d.toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' });

  if (ageMin <= staleAfter) return { text: `Копія: ${time} ✓`, stale: false };

  const days = Math.floor(ageMin / 1440);
  const hours = Math.floor(ageMin / 60);
  const text = days >= 1 ? `Копія: ${days} дн. тому ⚠` : `Копія: ${hours} год тому ⚠`;
  return { text, stale: true };
}

export function getFolderName() {
  return dirHandle ? dirHandle.name : '';
}
