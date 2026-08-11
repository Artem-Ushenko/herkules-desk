const TABS = [
  { screen: 'desk', label: 'Стійка' },
  { screen: 'clients', label: 'Клієнти' },
  { screen: 'sales', label: 'Продажі' },
  { screen: 'journal', label: 'Журнал' },
  { screen: 'settings', label: 'Налаштування' }
];

export default function Topbar({ screen, backupStatus, shift }) {
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
      <a
        className={'backup-status' + (shift ? '' : ' stale')}
        href="#settings"
        title="Відкрити/закрити зміну — Налаштування"
      >
        {shift ? `Зміна: ${shift.staff} з ${new Date(shift.openedAt).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' })}` : 'Зміна не відкрита'}
      </a>
      <div className={'backup-status' + (backupStatus?.stale ? ' stale' : '')} title="Стан останнього бекапу">
        {backupStatus?.text || 'Копія: —'}
      </div>
    </header>
  );
}
