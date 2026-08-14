// Точка входу: маршрути екранів, автозакриття, бекап, реєстрація Service Worker.

import { useEffect, useState } from 'react';
import Topbar from './components/Topbar.jsx';
import ShiftGate from './components/ShiftGate.jsx';
import PasswordGate from './components/PasswordGate.jsx';
import DeskScreen from './screens/DeskScreen.jsx';
import ClientsScreen from './screens/ClientsScreen.jsx';
import SalesScreen from './screens/SalesScreen.jsx';
import JournalScreen from './screens/JournalScreen.jsx';
import SettingsScreen from './screens/SettingsScreen.jsx';
import { initBackup, bindUnloadBackup, writeBackup, formatStatus } from './backup.js';
import { autoCloseStaleVisits } from './visits.js';
import { getCurrentShift, autoCloseStaleShift } from './shifts.js';
import { retryPendingReports } from './cloud.js';
import { useBackupStatus } from './hooks/useBackupStatus.js';

const SCREEN_NAMES = ['desk', 'clients', 'sales', 'journal', 'settings'];

// «Налаштування» — чутливий екран (тарифи, зміни, відновлення бази з файлу):
// вхід питає пароль адміністратора щоразу заново, без запам'ятовування
// розблокування. У бандл потрапляє лише SHA-256-хеш (.env.example). Локальна
// розробка без .env пароль не питає — той самий принцип, що в сестринському
// проєкті (Геркулес Шоп, mini_shop_POS/src/App.jsx).
const ADMIN_PASSWORD_HASH = import.meta.env.VITE_ADMIN_PASSWORD_SHA256;

function parseHash() {
  const [name, ...rest] = location.hash.slice(1).split('/');
  const screen = SCREEN_NAMES.includes(name) ? name : 'desk';
  return { screen, param: rest.join('/') || undefined };
}

export default function App() {
  const [route, setRoute] = useState(parseHash());
  const [, setTick] = useState(0); // форсує перерахунок «N днів тому» раз на хвилину
  const backupState = useBackupStatus();
  const [shift, setShift] = useState(undefined); // undefined — ще не завантажено, null — зміна не відкрита
  const [settingsUnlocked, setSettingsUnlocked] = useState(false);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Вихід з «Налаштувань» на будь-який інший екран скидає розблокування —
  // повернення туди знову питає пароль.
  useEffect(() => {
    if (route.screen !== 'settings') setSettingsUnlocked(false);
  }, [route.screen]);

  // Відкладені Telegram-звіти закриття зміни (cloud.js): досилаємо на старті
  // й при появі мережі, той самий принцип, що для бекапів/снапшотів у Шопі.
  useEffect(() => {
    retryPendingReports();
    window.addEventListener('online', retryPendingReports);
    return () => window.removeEventListener('online', retryPendingReports);
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
  // від візитів. Закриття зміни (авто чи явне) знову показує ShiftGate —
  // хтось має явно відкрити нову зміну, перш ніж стійка запрацює далі.
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

  // Гейт зміни: поки не завантажили стан з БД — нічого не показуємо (уникає
  // блимання гейтом на мить); поки зміну не відкрито явно — лише ShiftGate,
  // решта екранів (зокрема стійка) недоступні.
  if (shift === undefined) return null;
  if (!shift) return <ShiftGate />;

  return (
    <>
      <Topbar screen={route.screen} backupStatus={backupStatus} shift={shift} />
      <main id="screens">
        {route.screen === 'desk' && <DeskScreen />}
        {route.screen === 'clients' && <ClientsScreen param={route.param} />}
        {route.screen === 'sales' && <SalesScreen />}
        {route.screen === 'journal' && <JournalScreen />}
        {route.screen === 'settings' && (
          ADMIN_PASSWORD_HASH && !settingsUnlocked ? (
            <PasswordGate
              correctHash={ADMIN_PASSWORD_HASH}
              onUnlock={() => setSettingsUnlocked(true)}
              onBack={() => { location.hash = '#desk'; }}
            />
          ) : (
            <SettingsScreen />
          )
        )}
      </main>
    </>
  );
}
