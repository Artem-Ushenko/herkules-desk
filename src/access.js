// Правила допуску в зал. Чистий модуль без залежностей — тестується окремо.
// Порядок перевірок фіксований специфікацією (розділ 3.1), перша спрацювала — та й повертається.

// Скільки днів/візитів лишилось, коли вже треба попереджати
const WARN_DAYS = 3;
const WARN_VISITS = 2;

// 'YYYY-MM-DD' у місцевому часі. Порівняння дат — рядкове, на рівні доби:
// абонемент діє включно з endDate, час доби ролі не грає (правило 3.3).
export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// '2026-08-09' → '09.08.2026' для показу адміністратору
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function daysBetween(fromISO, toISO) {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000);
}

/**
 * Рішення про допуск.
 * @param {object} client
 * @param {Date} [now] — для тестів; за замовчуванням поточний момент
 * @returns {{allow: boolean, level: 'ok'|'warn'|'deny', reason: string}}
 */
export function evaluateAccess(client, now = new Date()) {
  // 1. Гості (запрошені власником залу) проходять без абонемента й без оплати
  if (client.type === 'guest') {
    return { allow: true, level: 'ok', reason: '' };
  }

  const sub = client.subscription;

  // 2
  if (!sub) {
    return { allow: false, level: 'deny', reason: 'Немає абонемента' };
  }

  // 3
  if (sub.freeze && sub.freeze.active) {
    return { allow: false, level: 'deny', reason: `Заморожено з ${formatDate(sub.freeze.since)}` };
  }

  const today = toISODate(now);
  const start = sub.startDate.slice(0, 10);
  const end = sub.endDate.slice(0, 10);

  // 4
  if (today < start) {
    return { allow: false, level: 'deny', reason: `Почнеться ${formatDate(start)}` };
  }

  // 5
  if (today > end) {
    return { allow: false, level: 'deny', reason: `Закінчився ${formatDate(end)}` };
  }

  // 6. visitsLeft === null — безліміт
  if (sub.visitsLeft !== null && sub.visitsLeft <= 0) {
    return { allow: false, level: 'deny', reason: 'Візити вичерпано' };
  }

  // 7
  const daysLeft = daysBetween(today, end);
  const fewDays = daysLeft <= WARN_DAYS;
  const fewVisits = sub.visitsLeft !== null && sub.visitsLeft <= WARN_VISITS;
  if (fewDays || fewVisits) {
    const parts = [];
    if (fewDays) parts.push(daysLeft === 0 ? 'останній день' : `лишилось ${daysLeft} дн.`);
    if (fewVisits) parts.push(`лишилось ${sub.visitsLeft} візит(и)`);
    return { allow: true, level: 'warn', reason: `Абонемент спливає: ${parts.join(', ')}` };
  }

  // 8
  return { allow: true, level: 'ok', reason: '' };
}

// Поріг нагадування адміну «зателефонувати клієнту про продовження» — окремо
// від WARN_DAYS (те попередження про допуск і про «жовтий» вердикт на скані;
// це — довший горизонт для дзвінка, поки клієнт ще встигає продовжити абонемент).
export const EXPIRY_REMINDER_DAYS = 5;

// Скільки днів лишилось до кінця активного абонемента — для нагадувань
// адміністратору (стійка при скані, список після відкриття зміни). null,
// якщо абонемента нема, він заморожений (лік днів не йде) або вже прострочений
// (для простроченого нагадування дзвонити пізно — там уже «Закінчився»).
export function daysUntilExpiry(client, now = new Date()) {
  const sub = client.subscription;
  if (!sub || (sub.freeze && sub.freeze.active)) return null;
  const today = toISODate(now);
  const end = sub.endDate.slice(0, 10);
  if (today > end) return null;
  return daysBetween(today, end);
}
