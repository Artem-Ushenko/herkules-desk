// Екран «Налаштування»: тарифи (M3); папка бекапів і відновлення — M4;
// зміни чергування (облік/звітність, без каси) — shifts.js.

import { useEffect, useState } from 'react';
import { CONFIG } from '../config.js';
import { STORES, getAll, put, remove } from '../db.js';
import { fmtMoney, fmtDateTime } from '../utils.js';
import ArmedButton from '../components/ArmedButton.jsx';
import { useBackupStatus } from '../hooks/useBackupStatus.js';
import {
  formatStatus, pickFolder, reconfirmPermission,
  writeBackup, getFolderName, readBackupFile, restoreFromSnapshot
} from '../backup.js';
import {
  getCurrentShift, getStaffList, addStaffName,
  openShift, closeCurrentShift, getRecentClosedShifts, summarize
} from '../shifts.js';
import { getCloudReportConfig, setCloudReportConfig, trySendReport } from '../cloud.js';

function TariffsBox() {
  const [tariffs, setTariffs] = useState([]);
  const [title, setTitle] = useState('');
  const [visits, setVisits] = useState('');
  const [days, setDays] = useState('');
  const [price, setPrice] = useState('');
  const [forVets, setForVets] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [etTitle, setEtTitle] = useState('');
  const [etVisits, setEtVisits] = useState('');
  const [etDays, setEtDays] = useState('');
  const [etPrice, setEtPrice] = useState('');
  const [etForVets, setEtForVets] = useState(false);

  const load = async () => setTariffs(await getAll(STORES.tariffs));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    await put(STORES.tariffs, {
      id: crypto.randomUUID(),
      title: title.trim(),
      visits: visits ? Number(visits) : null,
      days: Number(days),
      price: Number(price),
      forVeterans: forVets
    });
    setTitle(''); setVisits(''); setDays(''); setPrice(''); setForVets(false);
    load();
  };

  const startEdit = (t) => {
    setEditingId(t.id);
    setEtTitle(t.title);
    setEtVisits(t.visits === null ? '' : String(t.visits));
    setEtDays(String(t.days));
    setEtPrice(String(t.price));
    setEtForVets(t.forVeterans);
  };

  const saveEdit = async (t) => {
    await put(STORES.tariffs, {
      ...t,
      title: etTitle.trim(),
      visits: etVisits ? Number(etVisits) : null,
      days: Number(etDays),
      price: Number(etPrice),
      forVeterans: etForVets
    });
    setEditingId(null);
    load();
  };

  return (
    <div className="box">
      <h2>Тарифи</h2>
      <table className="data-table">
        <thead>
          <tr>{['Назва', 'Візитів', 'Днів', 'Ціна', 'Для ветеранів', ''].map((t) => <th key={t}>{t}</th>)}</tr>
        </thead>
        <tbody>
          {tariffs.map((t) => editingId === t.id ? (
            <tr key={t.id}>
              <td><input type="text" value={etTitle} onChange={(e) => setEtTitle(e.target.value)} /></td>
              <td><input type="number" placeholder="безліміт" min={1} style={{ width: 90 }} value={etVisits} onChange={(e) => setEtVisits(e.target.value)} /></td>
              <td><input type="number" min={1} style={{ width: 70 }} value={etDays} onChange={(e) => setEtDays(e.target.value)} /></td>
              <td><input type="number" min={0} style={{ width: 90 }} value={etPrice} onChange={(e) => setEtPrice(e.target.value)} /></td>
              <td><input type="checkbox" checked={etForVets} onChange={(e) => setEtForVets(e.target.checked)} /></td>
              <td>
                <button type="button" className="btn-primary" onClick={() => saveEdit(t)}>Зберегти</button>{' '}
                <button type="button" onClick={() => setEditingId(null)}>Скасувати</button>
              </td>
            </tr>
          ) : (
            <tr key={t.id}>
              <td>{t.title}</td>
              <td>{t.visits === null ? 'безліміт' : String(t.visits)}</td>
              <td>{t.days}</td>
              <td>{fmtMoney(t.price)}</td>
              <td>{t.forVeterans ? 'так' : ''}</td>
              <td>
                <button type="button" className="small" onClick={() => startEdit(t)}>✏️ Редагувати</button>{' '}
                <ArmedButton label="Видалити" confirmLabel="Точно?" onConfirm={async () => { await remove(STORES.tariffs, t.id); load(); }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!tariffs.length && <p className="muted">Тарифів ще немає — додайте перший</p>}

      <h3>Додати тариф</h3>
      <form className="inline-form wrap" onSubmit={submit}>
        <input type="text" placeholder="Назва, напр. «Пакет 8 візитів»" required value={title} onChange={(e) => setTitle(e.target.value)} />
        <input type="number" placeholder="Візитів (порожньо = безліміт)" min={1} value={visits} onChange={(e) => setVisits(e.target.value)} />
        <input type="number" placeholder="Термін, днів" required min={1} value={days} onChange={(e) => setDays(e.target.value)} />
        <input type="number" placeholder="Ціна, грн" required min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={forVets} onChange={(e) => setForVets(e.target.checked)} /> для ветеранів
        </label>
        <button type="submit" className="btn-primary">Додати</button>
      </form>
    </div>
  );
}

function ShiftBox() {
  const [shift, setShift] = useState(undefined); // undefined — ще не завантажено
  const [staffList, setStaffList] = useState([]);
  const [recent, setRecent] = useState([]);
  const [newName, setNewName] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [closedInfo, setClosedInfo] = useState(null);
  const [openingCash, setOpeningCash] = useState('');
  const [closePreview, setClosePreview] = useState(null); // не null = показана модалка закриття
  const [countedCash, setCountedCash] = useState('');

  const load = async () => {
    const [cur, staff, rec] = await Promise.all([getCurrentShift(), getStaffList(), getRecentClosedShifts()]);
    setShift(cur);
    setStaffList(staff);
    setRecent(rec);
  };
  useEffect(() => { load(); }, []);

  const notifyChanged = () => document.dispatchEvent(new CustomEvent('herkules:shift-changed'));

  const handleOpen = async (staff) => {
    setBusy(true);
    setError(null);
    try {
      await openShift(staff, Number(openingCash) || 0);
      setOpeningCash('');
      notifyChanged();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Підсумок рахується ще ДО закриття (summarize не пише в БД), щоб показати
  // очікувану готівку в модалці, поки той, хто закриває, ще не підтвердив.
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
      const closed = await closeCurrentShift('staff', counted);
      setClosedInfo(closed);
      setClosePreview(null);
      notifyChanged();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleAddStaff = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const updated = await addStaffName(newName);
      setStaffList(updated);
      setNewName('');
      setShowAdd(false);
    } catch (e) {
      setError(e.message);
    }
  };

  if (shift === undefined) return <div className="box"><h2>Зміна</h2></div>;

  const expectedCash = closePreview ? (shift.openingCash ?? 0) + closePreview.cashTotal : 0;
  const cashDelta = countedCash === '' ? null : Number(countedCash) - expectedCash;

  return (
    <div className="box">
      <h2>Зміна</h2>
      <p className="muted">
        Хто чергував на стійці, скільки візитів і оплат відбулось — відкриття/закриття
        також відкриває/закриває допуск за карткою. Розмінна готівка фіксується на
        вході й звіряється з підрахунком при закритті.
      </p>

      {shift ? (
        <>
          <p className="status-ok">
            👤 {shift.staff} · з {new Date(shift.openedAt).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' })}
            {' · розмінна '}{fmtMoney(shift.openingCash ?? 0)}
          </p>
          <button type="button" className="btn-danger" onClick={handleCloseClick}>Закрити зміну</button>
        </>
      ) : (
        <>
          <div className="cash-count-row" style={{ marginTop: 0, maxWidth: 280 }}>
            <label htmlFor="settings-opening-cash">Розмінна готівка</label>
            <input
              id="settings-opening-cash"
              type="number"
              inputMode="numeric"
              min="0"
              placeholder="0 ₴"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
            />
          </div>
          <div className="inline-form wrap">
            {staffList.map((name) => (
              <button key={name} type="button" className="btn-success" disabled={busy} onClick={() => handleOpen(name)}>
                👤 {name}
              </button>
            ))}
          </div>
          {showAdd ? (
            <form className="inline-form" onSubmit={handleAddStaff}>
              <input type="text" autoFocus placeholder="Ім'я" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button type="submit" disabled={!newName.trim()}>Додати</button>
            </form>
          ) : (
            <button type="button" className="small" onClick={() => setShowAdd(true)}>+ Додати</button>
          )}
        </>
      )}

      {error && <p className="status-deny">{error}</p>}

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

            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={() => setClosePreview(null)}>Скасувати</button>
              <button type="button" className="btn-danger" disabled={busy} onClick={handleConfirmClose}>
                {busy ? 'Закриваємо…' : 'Закрити зміну'}
              </button>
            </div>
          </div>
        </div>
      )}

      {closedInfo && (
        <p className="muted">
          Закрито: {closedInfo.staff} — візитів {closedInfo.visitCount}, оплат {closedInfo.paymentCount}{' '}
          (готівка {fmtMoney(closedInfo.cashTotal)} · картка {fmtMoney(closedInfo.cardTotal)}){' '}
          {closedInfo.countedCash != null && (
            closedInfo.countedCash === closedInfo.expectedCash
              ? '· каса зійшлася'
              : `· Δ ${closedInfo.countedCash - closedInfo.expectedCash > 0 ? '+' : ''}${fmtMoney(closedInfo.countedCash - closedInfo.expectedCash)}`
          )}
        </p>
      )}

      {recent.length > 0 && (
        <table className="data-table compact" style={{ marginTop: '.75rem' }}>
          <thead>
            <tr>{['Хто', 'Відкрито', 'Закрито', 'Візитів', 'Готівка', 'Картка', 'Δ готівки', ''].map((t) => <th key={t}>{t}</th>)}</tr>
          </thead>
          <tbody>
            {recent.map((s) => (
              <tr key={s.id}>
                <td>{s.staff}</td>
                <td>{fmtDateTime(s.openedAt)}</td>
                <td>{fmtDateTime(s.closedAt)}</td>
                <td>{s.visitCount}</td>
                <td>{fmtMoney(s.cashTotal)}</td>
                <td>{fmtMoney(s.cardTotal)}</td>
                <td className={s.countedCash != null && s.countedCash !== s.expectedCash ? 'status-deny' : ''}>
                  {s.countedCash == null ? '—' : (s.countedCash === s.expectedCash ? '✓' : fmtMoney(s.countedCash - s.expectedCash))}
                </td>
                <td>{s.closedBy === 'system' ? 'авто' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Звіт закриття зміни в Telegram (cloud.js) через проксі Apps Script — той самий
// скрипт, що вже приймає звіти від сестринського проєкту (Геркулес Шоп,
// mini_shop_POS/gerkules-snapshot-proxy.gs). URL/токен беруться з деплою
// скрипта (Deploy → Web app → /exec) і зберігаються в meta-сторі пристрою.
function CloudReportBox() {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCloudReportConfig().then((cfg) => { setUrl(cfg.url || ''); setToken(cfg.token || ''); });
  }, []);

  const save = async (e) => {
    e.preventDefault();
    await setCloudReportConfig({ url: url.trim(), token: token.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const sendTest = async () => {
    setBusy(true);
    setTestResult(null);
    await setCloudReportConfig({ url: url.trim(), token: token.trim() });
    const r = await trySendReport('🤖 Геркулес Клуб: тестове повідомлення з Налаштувань');
    setTestResult(r);
    setBusy(false);
  };

  return (
    <div className="box">
      <h2>Хмарні звіти (Telegram)</h2>
      <p className="muted">
        При закритті зміни (вручну чи автоматично) короткий звіт летить у Telegram
        через проксі-скрипт Apps Script — той самий, що в «Геркулес Шоп».
      </p>
      <form className="inline-form wrap" onSubmit={save}>
        <input type="text" placeholder="URL проксі (…/exec)" style={{ minWidth: 320 }} value={url} onChange={(e) => setUrl(e.target.value)} />
        <input type="text" placeholder="Токен (SECRET_TOKEN)" value={token} onChange={(e) => setToken(e.target.value)} />
        <button type="submit" className="btn-primary">Зберегти</button>
        <button type="button" disabled={!url.trim() || !token.trim() || busy} onClick={sendTest}>
          {busy ? 'Надсилаємо…' : 'Надіслати тест'}
        </button>
      </form>
      {saved && <p className="status-ok">Збережено</p>}
      {testResult && (
        <p className={testResult.ok ? 'status-ok' : 'status-deny'}>
          {testResult.ok ? '✓ Надіслано в Telegram' : `✗ ${testResult.error}`}
        </p>
      )}
    </div>
  );
}

function BackupBox() {
  const s = useBackupStatus();
  const [alerts, setAlerts] = useState([]);
  const [preview, setPreview] = useState(null); // { data, error }

  const alertLine = (message) => {
    const id = Math.random();
    setAlerts((a) => [...a, { id, message }]);
    setTimeout(() => setAlerts((a) => a.filter((x) => x.id !== id)), 5000);
  };

  if (!s) return <div className="box"><h2>Бекап</h2></div>;

  const { text, stale } = formatStatus(s);
  const detail = s.configured
    ? `Папка: ${getFolderName() || '(без назви)'}${s.lastError ? ' · ' + s.lastError : ''}`
    : `Кожні ${CONFIG.BACKUP_INTERVAL_MIN} хв, останні ${CONFIG.BACKUP_KEEP} файлів. Папка ще не вказана.`;

  const onFileChange = async (e) => {
    setPreview(null);
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await readBackupFile(file);
      setPreview({ data });
    } catch (err) {
      setPreview({ error: err.message });
    }
  };

  return (
    <div className="box">
      <h2>Бекап</h2>
      <p className={stale ? 'status-deny' : 'status-ok'}>{text}</p>
      <p className="muted">{detail}</p>
      <div className="inline-form">
        {!s.configured || !s.permissionOk ? (
          <button type="button" className="btn-primary" onClick={async () => {
            try { await (s.configured ? reconfirmPermission() : pickFolder()); }
            catch (err) { alertLine(err.message); }
          }}>{s.configured ? 'Вказати папку заново' : 'Обрати папку бекапів'}</button>
        ) : (
          <>
            <button type="button" onClick={async () => {
              const r = await writeBackup();
              if (!r.ok) alertLine('Не вдалося зробити бекап: ' + r.reason);
            }}>Зробити бекап зараз</button>
            <button type="button" onClick={async () => {
              try { await pickFolder(); } catch (err) { alertLine(err.message); }
            }}>Змінити папку</button>
          </>
        )}
      </div>
      {alerts.map((a) => <p key={a.id} className="status-deny">{a.message}</p>)}

      <h3>Відновлення з файлу</h3>
      <div className="inline-form">
        <input type="file" accept=".json" onChange={onFileChange} />
      </div>
      {preview?.error && <p className="status-deny">{preview.error}</p>}
      {preview?.data && <RestorePreview data={preview.data} />}
    </div>
  );
}

function RestorePreview({ data }) {
  const [done, setDone] = useState(false);
  if (done) return <p className="status-ok">Базу відновлено. Оновіть сторінку.</p>;
  return (
    <div className="banner warn-banner">
      <div>
        <b>У файлі: </b>
        клієнтів — {data.clients.length}, візитів — {data.visits.length}, оплат — {data.payments.length}, тарифів — {data.tariffs.length}.{' '}
        Знімок від {fmtDateTime(data.exportedAt)}.
      </div>
      <ArmedButton
        label="Відновити (замінить поточну базу)"
        confirmLabel="⚠ Точно замінити всю поточну базу цим файлом?"
        onConfirm={async () => { await restoreFromSnapshot(data); setDone(true); }}
      />
    </div>
  );
}

export default function SettingsScreen() {
  return (
    <>
      <TariffsBox />
      <ShiftBox />
      <CloudReportBox />
      <BackupBox />
    </>
  );
}
