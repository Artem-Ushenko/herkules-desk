import { useEffect, useState } from 'react';
import { onStatusChange } from '../backup.js';

// Повертає сирий стан бекапу (onStatusChange з backup.js) — reactive обгортка
// над подієвим API, спільна для Topbar (індикатор у шапці) і SettingsScreen.
export function useBackupStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => onStatusChange(setStatus), []);
  return status;
}
