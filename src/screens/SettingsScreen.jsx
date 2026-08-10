// Екран «Налаштування»: тарифи (M3); папка бекапів і відновлення — M4.

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
      <BackupBox />
    </>
  );
}
