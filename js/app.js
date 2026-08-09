// Точка входу: перемикання екранів і повернення фокуса в поле сканування.

import { initDesk, focusScan } from './desk.js';

const SCREENS = ['desk', 'clients', 'sales', 'journal', 'settings'];

function currentScreen() {
  const name = location.hash.slice(1).split('/')[0];
  return SCREENS.includes(name) ? name : 'desk';
}

function show(name) {
  for (const s of SCREENS) {
    document.getElementById('screen-' + s).hidden = s !== name;
  }
  document.querySelectorAll('#nav a').forEach(a =>
    a.classList.toggle('active', a.dataset.screen === name)
  );
  if (name === 'desk') focusScan();
}

window.addEventListener('hashchange', () => show(currentScreen()));

// Клік будь-де на порожньому місці стійки повертає фокус сканеру (розділ 5.1)
document.addEventListener('click', (e) => {
  const interactive = e.target.closest('button, a, input, select, textarea, label, form');
  if (!interactive && !document.getElementById('screen-desk').hidden) focusScan();
});

initDesk(document.getElementById('screen-desk'));
show(currentScreen());
