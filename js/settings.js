// Екран «Налаштування»: тарифи (M3); папка бекапів і відновлення — M4.

import { CONFIG } from './config.js';
import { STORES, getAll, put, remove } from './db.js';
import { h, fmtMoney, fmtDateTime, armedButton } from './ui.js';
import {
  onStatusChange, formatStatus, pickFolder, reconfirmPermission,
  writeBackup, getFolderName, readBackupFile, restoreFromSnapshot
} from './backup.js';

let root;
let backupUnsub = null;

export function initSettings(container) {
  root = container;
}

export async function onShowSettings() {
  const tariffs = await getAll(STORES.tariffs);
  root.innerHTML = '';

  const box = h('div', { class: 'box' });
  root.appendChild(box);
  box.appendChild(h('h2', {}, 'Тарифи'));

  box.appendChild(h('table', { class: 'data-table' }, [
    h('thead', {}, h('tr', {}, ['Назва', 'Візитів', 'Днів', 'Ціна', 'Для ветеранів', ''].map(t => h('th', {}, t)))),
    h('tbody', {}, tariffs.map(t => h('tr', {}, [
      h('td', {}, t.title),
      h('td', {}, t.visits === null ? 'безліміт' : String(t.visits)),
      h('td', {}, String(t.days)),
      h('td', {}, fmtMoney(t.price)),
      h('td', {}, t.forVeterans ? 'так' : ''),
      h('td', {}, armedButton('Видалити', 'Точно?', async () => {
        await remove(STORES.tariffs, t.id);
        onShowSettings();
      }))
    ])))
  ]));
  if (!tariffs.length) box.appendChild(h('p', { class: 'muted' }, 'Тарифів ще немає — додайте перший'));

  box.appendChild(h('h3', {}, 'Додати тариф'));
  const title = h('input', { type: 'text', placeholder: 'Назва, напр. «Пакет 8 візитів»', required: true });
  const visits = h('input', { type: 'number', placeholder: 'Візитів (порожньо = безліміт)', min: 1 });
  const days = h('input', { type: 'number', placeholder: 'Термін, днів', required: true, min: 1 });
  const price = h('input', { type: 'number', placeholder: 'Ціна, грн', required: true, min: 0 });
  const forVets = h('input', { type: 'checkbox' });
  const form = h('form', { class: 'inline-form wrap' }, [
    title, visits, days, price,
    h('label', { class: 'check' }, [forVets, ' для ветеранів']),
    h('button', { class: 'btn-primary', type: 'submit' }, 'Додати')
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await put(STORES.tariffs, {
      id: crypto.randomUUID(),
      title: title.value.trim(),
      visits: visits.value ? Number(visits.value) : null,
      days: Number(days.value),
      price: Number(price.value),
      forVeterans: forVets.checked
    });
    onShowSettings();
  });
  box.appendChild(form);

  root.appendChild(renderBackupBox());
}

function renderBackupBox() {
  const box = h('div', { class: 'box' });
  box.appendChild(h('h2', {}, 'Бекап'));

  const statusLine = h('p', {});
  const detailLine = h('p', { class: 'muted' });
  box.appendChild(statusLine);
  box.appendChild(detailLine);

  if (backupUnsub) backupUnsub();
  backupUnsub = onStatusChange((s) => {
    const { text, stale } = formatStatus(s);
    statusLine.textContent = text;
    statusLine.className = stale ? 'status-deny' : 'status-ok';
    detailLine.textContent = s.configured
      ? `Папка: ${getFolderName() || '(без назви)'}${s.lastError ? ' · ' + s.lastError : ''}`
      : `Кожні ${CONFIG.BACKUP_INTERVAL_MIN} хв, останні ${CONFIG.BACKUP_KEEP} файлів. Папка ще не вказана.`;

    // Проблема має бути видна одразу і не блокувати роботу (розділ 6)
    const actions = h('div', { class: 'inline-form' });
    if (!s.configured || !s.permissionOk) {
      actions.appendChild(h('button', { class: 'btn-primary', onclick: async () => {
        try { await (s.configured ? reconfirmPermission() : pickFolder()); }
        catch (err) { alertLine(box, err.message); }
      } }, s.configured ? 'Вказати папку заново' : 'Обрати папку бекапів'));
    } else {
      actions.appendChild(h('button', { onclick: async () => {
        const r = await writeBackup();
        if (!r.ok) alertLine(box, 'Не вдалося зробити бекап: ' + r.reason);
      } }, 'Зробити бекап зараз'));
      actions.appendChild(h('button', { onclick: async () => {
        try { await pickFolder(); } catch (err) { alertLine(box, err.message); }
      } }, 'Змінити папку'));
    }
    const old = box.querySelector('.inline-form');
    if (old) old.replaceWith(actions); else box.appendChild(actions);
  });

  box.appendChild(h('h3', {}, 'Відновлення з файлу'));
  const fileInput = h('input', { type: 'file', accept: '.json' });
  const preview = h('div', {});
  box.appendChild(h('div', { class: 'inline-form' }, [fileInput]));
  box.appendChild(preview);

  fileInput.addEventListener('change', async () => {
    preview.innerHTML = '';
    const file = fileInput.files[0];
    if (!file) return;
    let data;
    try {
      data = await readBackupFile(file);
    } catch (err) {
      preview.appendChild(h('p', { class: 'status-deny' }, err.message));
      return;
    }
    preview.appendChild(h('div', { class: 'banner warn-banner' }, [
      h('div', {}, [
        h('b', {}, 'У файлі: '),
        `клієнтів — ${data.clients.length}, візитів — ${data.visits.length}, оплат — ${data.payments.length}, тарифів — ${data.tariffs.length}. `,
        `Знімок від ${fmtDateTime(data.exportedAt)}.`
      ]),
      armedButton('Відновити (замінить поточну базу)', '⚠ Точно замінити всю поточну базу цим файлом?', async () => {
        await restoreFromSnapshot(data);
        preview.innerHTML = '';
        preview.appendChild(h('p', { class: 'status-ok' }, 'Базу відновлено. Оновіть сторінку.'));
      })
    ]));
  });

  return box;
}

function alertLine(container, message) {
  const el = h('p', { class: 'status-deny' }, message);
  container.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
