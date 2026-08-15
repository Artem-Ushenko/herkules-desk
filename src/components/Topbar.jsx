import { useState } from 'react';
import { closeCurrentShift, summarize } from '../shifts.js';
import { fmtMoney } from '../utils.js';

const TABS = [
  { screen: 'desk', label: 'Стійка' },
  { screen: 'clients', label: 'Клієнти' },
  { screen: 'sales', label: 'Продажі' },
  { screen: 'journal', label: 'Журнал' },
  { screen: 'settings', label: 'Налаштування' }
];

// Закриття зміни — тут, у шапці (доступно без пароля Налаштувань), а не лише
// в SettingsScreen.jsx ShiftBox: та ж модалка з підрахунком готівки на
// закритті, той самий принцип, що в сестринському проєкті (Геркулес Шоп).
export default function Topbar({ screen, backupStatus, shift }) {
  const [closePreview, setClosePreview] = useState(null); // не null = показана модалка закриття
  const [countedCash, setCountedCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const notifyChanged = () => document.dispatchEvent(new CustomEvent('herkules:shift-changed'));

  const handleCloseClick = async () => {
    setError(null);
    try {
      setCountedCash('');
      setClosePreview(await summarize(shift));
    } catch (e) {
      setError(e.message);
    }
  };

  const handleConfirmClose = async () => {
    setBusy(true);
    setError(null);
    try {
      const counted = countedCash === '' ? null : Number(countedCash);
      await closeCurrentShift('staff', counted);
      setClosePreview(null);
      notifyChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const expectedCash = closePreview ? (shift?.openingCash ?? 0) + closePreview.cashTotal : 0;
  const cashDelta = countedCash === '' ? null : Number(countedCash) - expectedCash;

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
          <button type="button" className="btn-danger" onClick={handleCloseClick}>Закрити зміну</button>
        </div>
      )}
      <div className={'backup-status' + (backupStatus?.stale ? ' stale' : '')} title="Стан останнього бекапу">
        {backupStatus?.text || 'Копія: —'}
      </div>

      {closePreview && (
        <div className="modal-overlay" onClick={() => !busy && setClosePreview(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Закрити зміну?</h2>
            <ul className="shift-summary">
              <li><span>Співробітник</span><strong>👤 {shift.staff}</strong></li>
              <li><span>Візитів</span><strong>{closePreview.visitCount}</strong></li>
              <li><span>Оплат</span><strong>{closePreview.paymentCount} на {fmtMoney(closePreview.total)}</strong></li>
              <li><span>· готівкою</span><strong>{fmtMoney(closePreview.cashTotal)}</strong></li>
              <li><span>· карткою</span><strong>{fmtMoney(closePreview.cardTotal)}</strong></li>
              <li><span>Розмінна на початку</span><strong>{fmtMoney(shift.openingCash ?? 0)}</strong></li>
              <li><span>Має бути в касі</span><strong>{fmtMoney(expectedCash)}</strong></li>
            </ul>

            <div className="cash-count-row">
              <label htmlFor="counted-cash">Порахована готівка</label>
              <input
                id="counted-cash"
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="₴"
                autoFocus
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
              />
            </div>
            {cashDelta !== null && (
              <p className={'cash-delta ' + (cashDelta === 0 ? 'ok' : 'bad')} style={{ textAlign: 'right' }}>
                {cashDelta === 0
                  ? '✓ Каса зійшлася'
                  : `Δ ${cashDelta > 0 ? '+' : ''}${fmtMoney(cashDelta)} ${cashDelta > 0 ? '(надлишок)' : '(недостача)'}`}
              </p>
            )}
            {error && <p className="status-deny">{error}</p>}

            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={() => setClosePreview(null)}>Скасувати</button>
              <button type="button" className="btn-danger" disabled={busy} onClick={handleConfirmClose}>
                {busy ? 'Закриваємо…' : 'Закрити зміну'}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
