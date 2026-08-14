// Звіт закриття зміни в Telegram через Apps Script-проксі — той самий скрипт,
// що вже приймає звіти від сестринського проєкту (Геркулес Шоп, mini_shop_POS/
// gerkules-snapshot-proxy.gs): doPost перевіряє token і, якщо в тілі є report,
// пересилає його в Telegram (BOT_TOKEN/CHAT_ID — налаштування самого проксі).
// Клуб шле лише текст звіту, без снапшота бази — локальний бекап (backup.js)
// уже покриває це окремо.
//
// URL і токен проксі задаються в Налаштуваннях і живуть у meta-сторі (IndexedDB
// пристрою), НЕ в публічному бандлі. Принцип незмінний: закриття зміни ніколи
// не чекає мережу і не падає через неї — невдала відправка ставить звіт у чергу
// (localStorage) і повторюється при наступному online/старті застосунку.

import { CONFIG } from './config.js';
import { getMeta, setMeta } from './db.js';

const REPORTS_KEY = 'herkules:pendingReports';
const MAX_QUEUED_REPORTS = 20;
const SEND_TIMEOUT_MS = 30_000;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function money(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('uk-UA')} ₴`;
}

export function formatShiftCloseReport(shift) {
  const bySystem = shift.closedBy === 'system';
  const lines = [
    `${bySystem ? '🔴' : '✅'} <b>${esc(CONFIG.CLUB_NAME)}</b> — зміну закрито о ${fmtTime(shift.closedAt)}` +
      (bySystem ? ' <b>автоматично системою</b> (не закрили вручну)' : ''),
    `👤 ${esc(shift.staff)} · відкрито о ${fmtTime(shift.openedAt)}`,
    `🚪 Візитів: ${shift.visitCount}`,
    `💰 Оплат: ${shift.paymentCount} на суму <b>${money(shift.total)}</b> ` +
      `(готівка ${money(shift.cashTotal)} · картка ${money(shift.cardTotal)})`
  ];
  return lines.join('\n');
}

export async function getCloudReportConfig() {
  return getMeta('cloudReport', { url: '', token: '' });
}

export function setCloudReportConfig(cfg) {
  return setMeta('cloudReport', cfg);
}

export async function isCloudReportConfigured() {
  const cfg = await getCloudReportConfig();
  return Boolean(cfg?.url && cfg?.token);
}

async function postReport(reportText) {
  const cfg = await getCloudReportConfig();
  if (!cfg?.url || !cfg?.token) {
    const err = new Error('Хмарні звіти не налаштовані (Налаштування → Хмарні звіти)');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    // Без заголовків: тіло йде як text/plain — «простий» запит без CORS-preflight,
    // якого Apps Script Web App не вміє обробити (той самий принцип, що в Шопі).
    const res = await fetch(cfg.url, {
      method: 'POST',
      body: JSON.stringify({ token: cfg.token, locationName: CONFIG.CLUB_NAME, report: reportText }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'проксі відхилив запит');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function getQueuedReports() {
  try {
    const arr = JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function queueReport(text) {
  const queue = [...getQueuedReports(), text];
  localStorage.setItem(REPORTS_KEY, JSON.stringify(queue.slice(-MAX_QUEUED_REPORTS)));
}

// Best-effort відправка: закриття зміни (shifts.js) ніколи не чекає і не падає
// через мережу чи хмару — помилка йде в повернене значення, не кидається.
export async function trySendReport(reportText) {
  try {
    const data = await postReport(reportText);
    return { ok: true, telegram: data.telegram };
  } catch (e) {
    if (e.code !== 'NOT_CONFIGURED') queueReport(reportText);
    return { ok: false, error: e.message };
  }
}

// Повтор відкладених звітів у порядку виникнення — виклик при старті застосунку
// і на подію online (App.jsx).
export async function retryPendingReports() {
  if (!(await isCloudReportConfigured())) return;
  let queue = getQueuedReports();
  while (queue.length) {
    try {
      await postReport(queue[0]);
    } catch {
      break; // мережі досі немає — решта черги чекає наступної спроби
    }
    queue = queue.slice(1);
    localStorage.setItem(REPORTS_KEY, JSON.stringify(queue));
  }
}
