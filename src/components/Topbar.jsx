import ArmedButton from './ArmedButton.jsx';
import { closeCurrentShift } from '../shifts.js';

const TABS = [
  { screen: 'desk', label: 'Стійка' },
  { screen: 'clients', label: 'Клієнти' },
  { screen: 'sales', label: 'Продажі' },
  { screen: 'journal', label: 'Журнал' },
  { screen: 'settings', label: 'Налаштування' }
];

export default function Topbar({ screen, backupStatus, shift }) {
  const handleClose = async () => {
    await closeCurrentShift('staff');
    document.dispatchEvent(new CustomEvent('herkules:shift-changed'));
  };

  return (
    <header className="topbar">
      <div className="brand">Геркулес</div>
      <nav className="tabs">
        {TABS.map((t) => (
          <a key={t.screen} href={'#' + t.screen} className={t.screen === screen ? 'active' : ''}>
            {t.label}
          </a>
        ))}
      </nav>
      {shift && (
        <div className="shift-status">
          <span className="backup-status">
            👤 {shift.staff} з {new Date(shift.openedAt).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <ArmedButton label="Закрити зміну" confirmLabel="Точно закрити?" onConfirm={handleClose} />
        </div>
      )}
      <div className={'backup-status' + (backupStatus?.stale ? ' stale' : '')} title="Стан останнього бекапу">
        {backupStatus?.text || 'Копія: —'}
      </div>
    </header>
  );
}
