// Точка входу: маршрути екранів і повернення фокуса в поле сканування.

import { initDesk, focusScan } from './desk.js';
import { initClients, onShowClients } from './clients.js';
import { initSales, onShowSales } from './sales.js';
import { initJournal, onShowJournal } from './journal.js';
import { initSettings, onShowSettings } from './settings.js';
import { initBackup, bindUnloadBackup, onStatusChange, formatStatus } from './backup.js';

const SCREENS = {
  desk: { onShow: () => focusScan() },
  clients: { onShow: onShowClients },
  sales: { onShow: onShowSales },
  journal: { onShow: onShowJournal },
  settings: { onShow: onShowSettings }
};

function route() {
  const [name, ...rest] = location.hash.slice(1).split('/');
  const screen = SCREENS[name] ? name : 'desk';
  for (const s of Object.keys(SCREENS)) {
    document.getElementById('screen-' + s).hidden = s !== screen;
  }
  document.querySelectorAll('#nav a').forEach(a =>
    a.classList.toggle('active', a.dataset.screen === screen)
  );
  SCREENS[screen].onShow(rest.join('/') || undefined);
}

window.addEventListener('hashchange', route);

// Клік будь-де на порожньому місці стійки повертає фокус сканеру (розділ 5.1)
document.addEventListener('click', (e) => {
  const interactive = e.target.closest('button, a, input, select, textarea, label, form');
  if (!interactive && !document.getElementById('screen-desk').hidden) focusScan();
});

initDesk(document.getElementById('screen-desk'));
initClients(document.getElementById('screen-clients'));
initSales(document.getElementById('screen-sales'));
initJournal(document.getElementById('screen-journal'));
initSettings(document.getElementById('screen-settings'));
route();

// Індикатор бекапу в шапці: проблема має бути видна одразу (розділ 6)
const backupEl = document.getElementById('backup-status');
let lastBackupState = null;
function renderBackupStatus() {
  if (!lastBackupState) return;
  const { text, stale } = formatStatus(lastBackupState);
  backupEl.textContent = text;
  backupEl.classList.toggle('stale', stale);
}
onStatusChange((s) => { lastBackupState = s; renderBackupStatus(); });
setInterval(renderBackupStatus, 60000); // «3 дні тому» має рости й без нових подій

initBackup();
bindUnloadBackup();
