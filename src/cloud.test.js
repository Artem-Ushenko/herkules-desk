// Тест форматування Telegram-звіту закриття зміни (формат живе тут, а не в
// проксі-скрипті — той самий принцип, що в cloud.js сестринського проєкту).

import { describe, it, expect } from 'vitest';
import { formatShiftCloseReport } from './cloud.js';

const openedAt = new Date(2026, 7, 12, 9, 5).getTime();
const closedAt = new Date(2026, 7, 12, 21, 30).getTime();

const closedShift = {
  staff: 'Оксана',
  openedAt,
  closedAt,
  closedBy: 'staff',
  visitCount: 12,
  paymentCount: 3,
  cashTotal: 650,
  cardTotal: 300,
  total: 950
};

describe('formatShiftCloseReport', () => {
  it('починається з чіткої мітки клубу, відокремленої від решти звіту', () => {
    const text = formatShiftCloseReport(closedShift);
    expect(text.startsWith('🏋️ <b>ГЕРКУЛЕС КЛУБ</b>\n')).toBe(true);
  });

  it('явне закриття — без позначки "автоматично", ✅', () => {
    const text = formatShiftCloseReport(closedShift);
    expect(text).toContain('✅');
    expect(text).not.toContain('автоматично');
    expect(text).toContain('👤 Оксана');
    expect(text).toContain('🚪 Візитів: 12');
    expect(text).toContain('950');
    expect(text).toContain('650');
    expect(text).toContain('300');
  });

  it('автозакриття системою — 🔴 і позначка "автоматично"', () => {
    const text = formatShiftCloseReport({ ...closedShift, closedBy: 'system' });
    expect(text).toContain('🔴');
    expect(text).toContain('автоматично системою');
  });

  it('екранує HTML-спецсимволи в імені співробітника', () => {
    const text = formatShiftCloseReport({ ...closedShift, staff: '<b>Хакер</b>&' });
    expect(text).not.toContain('<b>Хакер</b>');
    expect(text).toContain('&lt;b&gt;Хакер&lt;/b&gt;&amp;');
  });
});
