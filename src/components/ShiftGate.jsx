// Блокуючий екран перед стартом роботи: поки зміну не відкрито явно (обрано,
// хто чергує), решта застосунку (стійка, продажі тощо) не рендериться — див.
// App.jsx. Відкриття — зелена кнопка з іменем; після openShift() подія
// 'herkules:shift-changed' підхоплюється App і гейт зникає сам.

import { useEffect, useState } from 'react';
import { getStaffList, addStaffName, openShift } from '../shifts.js';

export default function ShiftGate() {
  const [staffList, setStaffList] = useState([]);
  const [newName, setNewName] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getStaffList().then(setStaffList); }, []);

  const notifyChanged = () => document.dispatchEvent(new CustomEvent('herkules:shift-changed'));

  const handleOpen = async (staff) => {
    setBusy(true);
    setError(null);
    try {
      await openShift(staff);
      notifyChanged();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const handleAddStaff = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const updated = await addStaffName(newName);
      setStaffList(updated);
      await handleOpen(newName.trim());
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="shift-gate">
      <div className="shift-gate-card">
        <h1>Хто на зміні?</h1>
        <p className="muted">
          Оберіть, хто зараз чергує на стійці — без цього допуск за карткою не почне працювати.
        </p>

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
            <button type="submit" className="btn-success" disabled={!newName.trim() || busy}>Відкрити зміну</button>
          </form>
        ) : (
          <button type="button" className="small" onClick={() => setShowAdd(true)}>+ Новий співробітник</button>
        )}

        {error && <p className="status-deny">{error}</p>}
      </div>
    </div>
  );
}
