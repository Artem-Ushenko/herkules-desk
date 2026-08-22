// Екран «Тренери»: реєстр тренерів і скільки персональних тренувань кожен
// провів за обраний місяць — джерело для розрахунку зарплати. Лічильник
// рахується з логу trainerSessions (subscriptions.js: markTrainerSessionUsed),
// що пишеться в картці клієнта кожного разу, коли натискають «Відмітити
// тренування» — тобто рахуються фактично проведені заняття, не куплені наперед.

import { useEffect, useState } from 'react';
import { addTrainer, renameTrainer, setTrainerArchived, getTrainerMonthlyStats } from '../subscriptions.js';
import ArmedButton from '../components/ArmedButton.jsx';

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default function TrainersScreen() {
  const [month, setMonth] = useState(currentMonth());
  const [stats, setStats] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState(null);

  const load = async () => setStats(await getTrainerMonthlyStats(month));

  useEffect(() => { load(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = stats.filter((t) => showArchived || !t.archivedAt);
  const total = visible.reduce((sum, t) => sum + t.count, 0);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await addTrainer(newName);
      setNewName('');
      load();
    } catch (err) { setError(err.message); }
  };

  const startEdit = (t) => { setEditingId(t.id); setEditName(t.name); setError(null); };

  const saveEdit = async (t) => {
    setError(null);
    try {
      await renameTrainer(t.id, editName);
      setEditingId(null);
      load();
    } catch (err) { setError(err.message); }
  };

  return (
    <>
      <div className="toolbar">
        <label>Місяць: <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <span className="spacer" />
        <b>Разом за місяць: {total}</b>
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> показати архівних
        </label>
      </div>

      <table className="data-table">
        <thead>
          <tr>{['Тренер', 'Тренувань за місяць', ''].map((t) => <th key={t}>{t}</th>)}</tr>
        </thead>
        <tbody>
          {visible.map((t) => editingId === t.id ? (
            <tr key={t.id}>
              <td><input type="text" autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} /></td>
              <td>{t.count}</td>
              <td>
                <button type="button" className="btn-primary" disabled={!editName.trim()} onClick={() => saveEdit(t)}>Зберегти</button>{' '}
                <button type="button" onClick={() => setEditingId(null)}>Скасувати</button>
              </td>
            </tr>
          ) : (
            <tr key={t.id}>
              <td>{t.name} {t.archivedAt && <span className="badge">архів</span>}</td>
              <td>{t.count}</td>
              <td>
                <button type="button" className="small" onClick={() => startEdit(t)}>✏️ Перейменувати</button>{' '}
                {t.archivedAt ? (
                  <button type="button" className="small" onClick={async () => { await setTrainerArchived(t.id, false); load(); }}>Повернути з архіву</button>
                ) : (
                  <ArmedButton
                    label="В архів"
                    confirmLabel="Точно?"
                    onConfirm={async () => { await setTrainerArchived(t.id, true); load(); }}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!visible.length && <p className="stub">Тренерів ще немає — додайте нижче</p>}

      <div className="box">
        <h3>Додати тренера</h3>
        <form className="inline-form" onSubmit={submit}>
          <input type="text" placeholder="Ім'я тренера" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button type="submit" className="btn-primary" disabled={!newName.trim()}>Додати</button>
        </form>
        {error && <p className="status-deny">{error}</p>}
      </div>
    </>
  );
}
