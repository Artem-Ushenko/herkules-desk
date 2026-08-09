// Тести правил допуску — всі 8 гілок таблиці 3.1 плюс граничні випадки.

import { test, assertEqual, assert } from './runner.js';
import { evaluateAccess, toISODate, formatDate } from '../js/access.js';

// «Сьогодні» у тестах зафіксовано, щоб результати не залежали від дати запуску
const NOW = new Date('2026-08-09T12:00:00');

function member(sub) {
  return { id: 'HC0001', type: 'member', name: 'Тест', subscription: sub };
}

function activeSub(over = {}) {
  return {
    tariffId: 't1',
    title: 'Місяць безліміт',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    visitsTotal: null,
    visitsLeft: null,
    freeze: { active: false, since: null, reason: null, daysUsed: 0 },
    ...over
  };
}

// ── Гілка 1: гість і тренер проходять без абонемента ──

test('1. гість орендаря — дозволено без абонемента', () => {
  const r = evaluateAccess({ type: 'guest', hostTrainerId: 'HC0100' }, NOW);
  assertEqual(r, { allow: true, level: 'ok', reason: '' });
});

test('1. тренер-орендар — дозволено без абонемента', () => {
  const r = evaluateAccess({ type: 'trainer' }, NOW);
  assertEqual(r, { allow: true, level: 'ok', reason: '' });
});

test('1. гість із простроченим абонементом усе одно проходить (абонемент не перевіряється)', () => {
  const r = evaluateAccess({ type: 'guest', subscription: activeSub({ endDate: '2026-01-01' }) }, NOW);
  assertEqual(r.allow, true);
});

// ── Гілка 2: немає абонемента ──

test('2. клієнт без абонемента — відмова', () => {
  const r = evaluateAccess(member(undefined), NOW);
  assertEqual(r, { allow: false, level: 'deny', reason: 'Немає абонемента' });
});

// ── Гілка 3: заморозка ──

test('3. заморожений абонемент не пускає, у причині дата заморозки', () => {
  const sub = activeSub({ freeze: { active: true, since: '2026-08-05', reason: 'injury', daysUsed: 4 } });
  const r = evaluateAccess(member(sub), NOW);
  assertEqual(r, { allow: false, level: 'deny', reason: 'Заморожено з 05.08.2026' });
});

test('3. заморозка перевіряється раніше за термін: заморожений і прострочений → «Заморожено»', () => {
  const sub = activeSub({
    endDate: '2026-08-01',
    freeze: { active: true, since: '2026-07-20', reason: 'service', daysUsed: 20 }
  });
  const r = evaluateAccess(member(sub), NOW);
  assert(r.reason.startsWith('Заморожено'), `отримано: ${r.reason}`);
});

// ── Гілка 4: ще не почався ──

test('4. абонемент з майбутнього — відмова з датою початку', () => {
  const sub = activeSub({ startDate: '2026-09-01', endDate: '2026-09-30' });
  const r = evaluateAccess(member(sub), NOW);
  assertEqual(r, { allow: false, level: 'deny', reason: 'Почнеться 01.09.2026' });
});

test('4. перший день дії — вже пускає', () => {
  const sub = activeSub({ startDate: '2026-08-09', endDate: '2026-09-08' });
  const r = evaluateAccess(member(sub), NOW);
  assertEqual(r.allow, true);
});

// ── Гілка 5: закінчився ──

test('5. прострочений абонемент — відмова з датою закінчення', () => {
  const sub = activeSub({ startDate: '2026-07-01', endDate: '2026-08-05' });
  const r = evaluateAccess(member(sub), NOW);
  assertEqual(r, { allow: false, level: 'deny', reason: 'Закінчився 05.08.2026' });
});

test('5. endDate = сьогодні — ще пускає (день закінчення включно, правило 3.3)', () => {
  const sub = activeSub({ endDate: '2026-08-09' });
  const r = evaluateAccess(member(sub), NOW);
  assertEqual(r.allow, true);
});

test('5. endDate = сьогодні пізно ввечері — час доби не впливає', () => {
  const sub = activeSub({ endDate: '2026-08-09' });
  const r = evaluateAccess(member(sub), new Date('2026-08-09T22:59:00'));
  assertEqual(r.allow, true);
});

// ── Гілка 6: візити вичерпано ──

test('6. visitsLeft = 0 — відмова', () => {
  const sub = activeSub({ visitsTotal: 8, visitsLeft: 0 });
  const r = evaluateAccess(member(sub), NOW);
  assertEqual(r, { allow: false, level: 'deny', reason: 'Візити вичерпано' });
});

test('6. visitsLeft = null — безліміт, не блокує', () => {
  const sub = activeSub({ visitsTotal: null, visitsLeft: null });
  const r = evaluateAccess(member(sub), NOW);
  assertEqual(r.allow, true);
});

// ── Гілка 7: попередження ──

test('7. лишилось 2 візити — пускає з попередженням', () => {
  const sub = activeSub({ visitsTotal: 8, visitsLeft: 2 });
  const r = evaluateAccess(member(sub), NOW);
  assertEqual(r.allow, true);
  assertEqual(r.level, 'warn');
  assert(r.reason.includes('2 візит'), `отримано: ${r.reason}`);
});

test('7. лишилось 3 дні — пускає з попередженням', () => {
  const sub = activeSub({ endDate: '2026-08-12' });
  const r = evaluateAccess(member(sub), NOW);
  assertEqual(r.level, 'warn');
  assert(r.reason.includes('3 дн'), `отримано: ${r.reason}`);
});

test('7. останній день дії — попередження «останній день»', () => {
  const sub = activeSub({ endDate: '2026-08-09' });
  const r = evaluateAccess(member(sub), NOW);
  assertEqual(r.level, 'warn');
  assert(r.reason.includes('останній день'), `отримано: ${r.reason}`);
});

test('7. мало і днів, і візитів — обидві причини в тексті', () => {
  const sub = activeSub({ endDate: '2026-08-10', visitsTotal: 8, visitsLeft: 1 });
  const r = evaluateAccess(member(sub), NOW);
  assertEqual(r.level, 'warn');
  assert(r.reason.includes('дн') && r.reason.includes('візит'), `отримано: ${r.reason}`);
});

// ── Гілка 8: усе гаразд ──

test('8. активний абонемент із запасом — зелений без попереджень', () => {
  const sub = activeSub({ visitsTotal: 12, visitsLeft: 10 });
  const r = evaluateAccess(member(sub), NOW);
  assertEqual(r, { allow: true, level: 'ok', reason: '' });
});

test('8. безліміт, 4 дні до кінця — ще зелений (межа попередження — 3)', () => {
  const sub = activeSub({ endDate: '2026-08-13' });
  const r = evaluateAccess(member(sub), NOW);
  assertEqual(r, { allow: true, level: 'ok', reason: '' });
});

// ── Допоміжні функції ──

test('toISODate — місцева дата без зсуву часових поясів', () => {
  assertEqual(toISODate(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
});

test('formatDate — ISO у людський формат', () => {
  assertEqual(formatDate('2026-08-09'), '09.08.2026');
  assertEqual(formatDate(''), '');
});
