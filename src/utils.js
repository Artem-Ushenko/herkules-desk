// Дрібні форматери, спільні для екранів.

// Готівка/картка з payment.cashAmount/cardAmount (розділена оплата), з фолбеком
// на старий payment.method+amount для записів до впровадження цього поля.
export function paymentSplit(p) {
  const cash = Math.abs(p.cashAmount ?? (p.method === 'cash' ? p.amount : 0));
  const card = Math.abs(p.cardAmount ?? (p.method === 'card' ? p.amount : 0));
  return { cash, card };
}

export function paymentMethodLabel(p) {
  const { cash, card } = paymentSplit(p);
  if (cash > 0 && card > 0) return `💵 ${fmtMoney(cash)} · 💳 ${fmtMoney(card)}`;
  return card > 0 ? 'картка' : 'готівка';
}

export function fmtMoney(n) {
  return new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH', maximumFractionDigits: 0 }).format(n);
}

export function fmtDateTime(tsOrIso) {
  const d = typeof tsOrIso === 'number' ? new Date(tsOrIso) : new Date(tsOrIso);
  return d.toLocaleString('uk', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Експорт CSV: BOM, щоб Excel відкривав кирилицю без питань
export function downloadCSV(filename, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const text = '﻿' + rows.map(r => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
