// Дрібні помічники інтерфейсу, спільні для екранів.

// h('div', {class: 'x', onclick: fn}, [діти]) — коротке створення елементів.
// Текст завжди через textContent, щоб дані клієнтів не інтерпретувались як HTML.
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
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

// Двокрокове підтвердження без window.confirm: перший клік озброює кнопку
export function armedButton(label, confirmLabel, action, className = 'btn-danger') {
  let armed = false;
  const b = h('button', {
    onclick: async () => {
      if (!armed) {
        armed = true;
        b.textContent = confirmLabel;
        b.classList.add(className);
        setTimeout(() => { armed = false; b.textContent = label; b.classList.remove(className); }, 5000);
        return;
      }
      await action();
    }
  }, label);
  return b;
}
