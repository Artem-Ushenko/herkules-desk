// Екран «Налаштування»: тарифи (M3); папка бекапів і відновлення — M4.

import { STORES, getAll, put, remove } from './db.js';
import { h, fmtMoney, armedButton } from './ui.js';

let root;

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

  // Розділ бекапів додається на етапі M4
  const backupBox = h('div', { class: 'box' });
  root.appendChild(backupBox);
  backupBox.appendChild(h('h2', {}, 'Бекап'));
  backupBox.appendChild(h('p', { class: 'muted' }, 'Налаштування папки бекапів зʼявиться на етапі M4.'));
}
