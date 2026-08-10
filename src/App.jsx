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

  // Автозакриття о CLOSE_TIME (розділ 3.5): перевіряємо щохвилини, а не лише
  // на скані — застосунок працює цілий день, адмін може весь час бути на
  // іншому екрані. Автозакриття = «закриття зміни» → одразу бекап (розділ 6).
  useEffect(() => {
    async function runAutoClose() {
      const closed = await autoCloseStaleVisits();
      if (closed > 0) {
        writeBackup();
        document.dispatchEvent(new CustomEvent('herkules:visits-changed'));
      }
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
      <Topbar screen={route.screen} backupStatus={backupStatus} />
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
