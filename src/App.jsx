// Точка входу: маршрути екранів, автозакриття, бекап, реєстрація Service Worker.

import { useEffect, useState } from 'react';
import Topbar from './components/Topbar.jsx';
import DeskScreen from './screens/DeskScreen.jsx';
import ClientsScreen from './screens/ClientsScreen.jsx';
import SalesScreen from './screens/SalesScreen.jsx';
import JournalScreen from './screens/JournalScreen.jsx';
import SettingsScreen from './screens/SettingsScreen.jsx';
import { initBackup, bindUnloadBackup, writeBackup, formatStatus } from './backup.js';
import { autoCloseStaleVisits } from './visits.js';
import { getCurrentShift, autoCloseStaleShift } from './shifts.js';
import { useBackupStatus } from './hooks/useBackupStatus.js';

const SCREEN_NAMES = ['desk', 'clients', 'sales', 'journal', 'settings'];

function parseHash() {
  const [name, ...rest] = location.hash.slice(1).split('/');
  const screen = SCREEN_NAMES.includes(name) ? name : 'desk';
  return { screen, param: rest.join('/') || undefined };
}

export default function App() {
  const [route, setRoute] = useState(parseHash());
  const [, setTick] = useState(0); // форсує перерахунок «N днів тому» раз на хвилину
  const backupState = useBackupStatus();
  const [shift, setShift] = useState(null);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Індикатор бекапу в шапці: проблема має бути видна одразу (розділ 6);
  // «N днів тому» має рости й без нових подій — тому окремий тік раз на хвилину
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    initBackup();
    bindUnloadBackup();
  }, []);

  // Статус чергування в шапці: перечитується одразу після відкриття/закриття
  // (подія від ShiftBox), а не лише разом із рештою автозакриттів раз на хвилину.
  useEffect(() => {
    const refresh = () => getCurrentShift().then(setShift);
    refresh();
    document.addEventListener('herkules:shift-changed', refresh);
    return () => document.removeEventListener('herkules:shift-changed', refresh);
  }, []);

  // Автозакриття о CLOSE_TIME (розділ 3.5): перевіряємо щохвилини, а не лише
  // на скані — застосунок працює цілий день, адмін може весь час бути на
  // іншому екрані. Автозакриття = «закриття зміни» → одразу бекап (розділ 6).
  // Чергування (shifts.js) автозакривається за тим самим правилом, незалежно
  // від візитів — це облік/звітність, не гейт (DeskScreen працює завжди).
  useEffect(() => {
    async function runAutoClose() {
      const closedVisits = await autoCloseStaleVisits();
      const closedShift = await autoCloseStaleShift();
      if (closedVisits > 0) document.dispatchEvent(new CustomEvent('herkules:visits-changed'));
      if (closedShift) document.dispatchEvent(new CustomEvent('herkules:shift-changed'));
      if (closedVisits > 0 || closedShift) writeBackup();
    }
    runAutoClose();
    const t = setInterval(runAutoClose, 60000);
    return () => clearInterval(t);
  }, []);

  // Service Worker: офлайн-режим (розділ 1, M5). Реєстрація — автоматично
  // через vite-plugin-pwa (injectRegister: 'auto' у vite.config.js), лише
  // в build/preview — у dev-режимі PWA вимкнено, це нормально.

  const backupStatus = backupState ? formatStatus(backupState) : null;

  return (
    <>
      <Topbar screen={route.screen} backupStatus={backupStatus} shift={shift} />
      <main id="screens">
        {route.screen === 'desk' && <DeskScreen />}
        {route.screen === 'clients' && <ClientsScreen param={route.param} />}
        {route.screen === 'sales' && <SalesScreen />}
        {route.screen === 'journal' && <JournalScreen />}
        {route.screen === 'settings' && <SettingsScreen />}
      </main>
    </>
  );
}
