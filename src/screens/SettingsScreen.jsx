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
  openShift, closeCurrentShift, getRecentClosedShifts
} from '../shifts.js';

function TariffsBox() {
  const [tariffs, setTariffs] = useState([]);
  const [title, setTitle] = useState('');
  const [visits, setVisits] = useState('');
  const [days, setDays] = useState('');
  const [price, setPrice] = useState('');
  const [forVets, setForVets] = useState(false);

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

  return (
    <div className="box">
      <h2>Тарифи</h2>
      <table className="data-table">
        <thead>
          <tr>{['Назва', 'Візитів', 'Днів', 'Ціна', 'Для ветеранів', ''].map((t) => <th key={t}>{t}</th>)}</tr>
        </thead>
        <tbody>
          {tariffs.map((t) => (
            <tr key={t.id}>
              <td>{t.title}</td>
              <td>{t.visits === null ? 'безліміт' : String(t.visits)}</td>
              <td>{t.days}</td>
              <td>{fmtMoney(t.price)}</td>
              <td>{t.forVeterans ? 'так' : ''}</td>
              <td><ArmedButton label="Видалити" confirmLabel="Точно?" onConfirm={async () => { await remove(STORES.tariffs, t.id); load(); }} /></td>
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
      await openShift(staff);
      notifyChanged();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    setBusy(true);
    setError(null);
    try {
      const closed = await closeCurrentShift('staff');
      setClosedInfo(closed);
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

  return (
    <div className="box">
      <h2>Зміна</h2>
      <p className="muted">
        Хто чергував на стійці, скільки візитів і оплат відбулось — облік/звітність,
        не впливає на допуск за карткою. Готівка й каса — окремо, в «Геркулес Шоп».
      </p>

      {shift ? (
        <>
          <p className="status-ok">
            👤 {shift.staff} · з {new Date(shift.openedAt).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <ArmedButton
            label="Закрити зміну"
            confirmLabel="Точно закрити?"
            className="btn-primary"
            onConfirm={handleClose}
          />
        </>
      ) : (
        <>
          <div className="inline-form wrap">
            {staffList.map((name) => (
              <button key={name} type="button" disabled={busy} onClick={() => handleOpen(name)}>
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

      {closedInfo && (
        <p className="muted">
          Закрито: {closedInfo.staff} — візитів {closedInfo.visitCount}, оплат {closedInfo.paymentCount}{' '}
          (готівка {fmtMoney(closedInfo.cashTotal)} · картка {fmtMoney(closedInfo.cardTotal)})
        </p>
      )}

      {recent.length > 0 && (
        <table className="data-table compact" style={{ marginTop: '.75rem' }}>
          <thead>
            <tr>{['Хто', 'Відкрито', 'Закрито', 'Візитів', 'Готівка', 'Картка', ''].map((t) => <th key={t}>{t}</th>)}</tr>
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
                <td>{s.closedBy === 'system' ? 'авто' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
      <BackupBox />
    </>
  );
}
