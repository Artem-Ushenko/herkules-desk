// Тести правил допуску — всі 8 гілок таблиці 3.1 плюс граничні випадки.

import { describe, it, expect } from 'vitest';
import { evaluateAccess, toISODate, formatDate } from './access.js';

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

describe('evaluateAccess', () => {
  // ── Гілка 1: гість проходить без абонемента ──

  it('1. гість — дозволено без абонемента', () => {
    const r = evaluateAccess({ type: 'guest' }, NOW);
    expect(r).toEqual({ allow: true, level: 'ok', reason: '' });
  });

  it('1. гість із простроченим абонементом усе одно проходить (абонемент не перевіряється)', () => {
    const r = evaluateAccess({ type: 'guest', subscription: activeSub({ endDate: '2026-01-01' }) }, NOW);
    expect(r.allow).toBe(true);
  });

  // ── Гілка 2: немає абонемента ──

  it('2. клієнт без абонемента — відмова', () => {
    const r = evaluateAccess(member(undefined), NOW);
    expect(r).toEqual({ allow: false, level: 'deny', reason: 'Немає абонемента' });
  });

  // ── Гілка 3: заморозка ──

  it('3. заморожений абонемент не пускає, у причині дата заморозки', () => {
    const sub = activeSub({ freeze: { active: true, since: '2026-08-05', reason: 'injury', daysUsed: 4 } });
    const r = evaluateAccess(member(sub), NOW);
    expect(r).toEqual({ allow: false, level: 'deny', reason: 'Заморожено з 05.08.2026' });
  });

  it('3. заморозка перевіряється раніше за термін: заморожений і прострочений → «Заморожено»', () => {
    const sub = activeSub({
      endDate: '2026-08-01',
      freeze: { active: true, since: '2026-07-20', reason: 'service', daysUsed: 20 }
    });
    const r = evaluateAccess(member(sub), NOW);
    expect(r.reason.startsWith('Заморожено'), `отримано: ${r.reason}`).toBe(true);
  });

  // ── Гілка 4: ще не почався ──

  it('4. абонемент з майбутнього — відмова з датою початку', () => {
    const sub = activeSub({ startDate: '2026-09-01', endDate: '2026-09-30' });
    const r = evaluateAccess(member(sub), NOW);
    expect(r).toEqual({ allow: false, level: 'deny', reason: 'Почнеться 01.09.2026' });
  });

  it('4. перший день дії — вже пускає', () => {
    const sub = activeSub({ startDate: '2026-08-09', endDate: '2026-09-08' });
    const r = evaluateAccess(member(sub), NOW);
    expect(r.allow).toBe(true);
  });

  // ── Гілка 5: закінчився ──

  it('5. прострочений абонемент — відмова з датою закінчення', () => {
    const sub = activeSub({ startDate: '2026-07-01', endDate: '2026-08-05' });
    const r = evaluateAccess(member(sub), NOW);
    expect(r).toEqual({ allow: false, level: 'deny', reason: 'Закінчився 05.08.2026' });
  });

  it('5. endDate = сьогодні — ще пускає (день закінчення включно, правило 3.3)', () => {
    const sub = activeSub({ endDate: '2026-08-09' });
    const r = evaluateAccess(member(sub), NOW);
    expect(r.allow).toBe(true);
  });

  it('5. endDate = сьогодні пізно ввечері — час доби не впливає', () => {
    const sub = activeSub({ endDate: '2026-08-09' });
    const r = evaluateAccess(member(sub), new Date('2026-08-09T22:59:00'));
    expect(r.allow).toBe(true);
  });

  // ── Гілка 6: візити вичерпано ──

  it('6. visitsLeft = 0 — відмова', () => {
    const sub = activeSub({ visitsTotal: 8, visitsLeft: 0 });
    const r = evaluateAccess(member(sub), NOW);
    expect(r).toEqual({ allow: false, level: 'deny', reason: 'Візити вичерпано' });
  });

  it('6. visitsLeft = null — безліміт, не блокує', () => {
    const sub = activeSub({ visitsTotal: null, visitsLeft: null });
    const r = evaluateAccess(member(sub), NOW);
    expect(r.allow).toBe(true);
  });

  // ── Гілка 7: попередження ──

  it('7. лишилось 2 візити — пускає з попередженням', () => {
    const sub = activeSub({ visitsTotal: 8, visitsLeft: 2 });
    const r = evaluateAccess(member(sub), NOW);
    expect(r.allow).toBe(true);
    expect(r.level).toBe('warn');
    expect(r.reason.includes('2 візит'), `отримано: ${r.reason}`).toBe(true);
  });

  it('7. лишилось 3 дні — пускає з попередженням', () => {
    const sub = activeSub({ endDate: '2026-08-12' });
    const r = evaluateAccess(member(sub), NOW);
    expect(r.level).toBe('warn');
    expect(r.reason.includes('3 дн'), `отримано: ${r.reason}`).toBe(true);
  });

  it('7. останній день дії — попередження «останній день»', () => {
    const sub = activeSub({ endDate: '2026-08-09' });
    const r = evaluateAccess(member(sub), NOW);
    expect(r.level).toBe('warn');
    expect(r.reason.includes('останній день'), `отримано: ${r.reason}`).toBe(true);
  });

  it('7. мало і днів, і візитів — обидві причини в тексті', () => {
    const sub = activeSub({ endDate: '2026-08-10', visitsTotal: 8, visitsLeft: 1 });
    const r = evaluateAccess(member(sub), NOW);
    expect(r.level).toBe('warn');
    expect(r.reason.includes('дн') && r.reason.includes('візит'), `отримано: ${r.reason}`).toBe(true);
  });

  // ── Гілка 8: усе гаразд ──

  it('8. активний абонемент із запасом — зелений без попереджень', () => {
    const sub = activeSub({ visitsTotal: 12, visitsLeft: 10 });
    const r = evaluateAccess(member(sub), NOW);
    expect(r).toEqual({ allow: true, level: 'ok', reason: '' });
  });

  it('8. безліміт, 4 дні до кінця — ще зелений (межа попередження — 3)', () => {
    const sub = activeSub({ endDate: '2026-08-13' });
    const r = evaluateAccess(member(sub), NOW);
    expect(r).toEqual({ allow: true, level: 'ok', reason: '' });
  });

  // ── Допоміжні функції ──

  it('toISODate — місцева дата без зсуву часових поясів', () => {
    expect(toISODate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });

  it('formatDate — ISO у людський формат', () => {
    expect(formatDate('2026-08-09')).toBe('09.08.2026');
    expect(formatDate('')).toBe('');
  });
});
