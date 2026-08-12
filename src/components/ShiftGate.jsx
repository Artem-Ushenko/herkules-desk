// Блокуючий екран перед стартом роботи: поки зміну не відкрито явно (обрано,
// хто чергує), решта застосунку (стійка, продажі тощо) не рендериться — див.
// App.jsx. Структура і текст — ті самі, що в OpenShiftScreen.jsx сестринського
// проєкту (Геркулес Шоп, mini_shop_POS/src/screens/OpenShiftScreen.jsx): вибір
// зі списку → підтвердження в модалці → openShift(). Клубні поля (точка,
// розмінна готівка, ярлики Облік/Журнал/Налаштування) з Шопу свідомо не
// перенесені — для клубу сенсу не мають.

import { useEffect, useState } from 'react';
import { getStaffList, addStaffName, renameStaffName, removeStaffName, openShift } from '../shifts.js';

export default function ShiftGate() {
  const [staffList, setStaffList] = useState([]);
  const [newName, setNewName] = useState('');
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [confirmingStaff, setConfirmingStaff] = useState(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(null);
  const [editingStaff, setEditingStaff] = useState(null);
  const [editStaffName, setEditStaffName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(null);

  useEffect(() => { getStaffList().then(setStaffList); }, []);

  const notifyChanged = () => document.dispatchEvent(new CustomEvent('herkules:shift-changed'));

  async function handleOpen(staff) {
    setOpening(true);
    setError(null);
    try {
      await openShift(staff);
      notifyChanged();
    } catch (e) {
      setError(e.message);
      setOpening(false);
      setConfirmingStaff(null);
    }
  }

  function handleConfirmOpen() {
    handleOpen(confirmingStaff);
  }

  async function handleAddStaff(e) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || staffList.includes(trimmed)) return;
    setError(null);
    try {
      const updated = await addStaffName(trimmed);
      setStaffList(updated);
      setNewName('');
      setShowAddStaff(false);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRename(oldName) {
    setError(null);
    try {
      const updated = await renameStaffName(oldName, editStaffName);
      setStaffList(updated);
      setEditingStaff(null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(name) {
    setError(null);
    try {
      const updated = await removeStaffName(name);
      setStaffList(updated);
      setConfirmingDelete(null);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="shift-gate">
      <div className="shift-gate-card">
        <h1 className="gate-brand">ГЕРКУЛЕС КЛУБ</h1>

        <h2 className="setup-subtitle">Хто відкриває зміну?</h2>
        <div className="staff-pick-list">
          {staffList.map((name) => (
            <div key={name} className="staff-pick-row">
              {editingStaff === name ? (
                <div className="manage-edit-form">
                  <div className="manage-form-row">
                    <input
                      type="text"
                      autoFocus
                      value={editStaffName}
                      onChange={(e) => setEditStaffName(e.target.value)}
                    />
                  </div>
                  <div className="manage-edit-actions">
                    <button type="button" className="btn-primary" disabled={!editStaffName.trim()} onClick={() => handleRename(name)}>
                      Зберегти
                    </button>
                    <button type="button" onClick={() => setEditingStaff(null)}>Скасувати</button>
                  </div>
                </div>
              ) : confirmingDelete === name ? (
                <div className="cancel-confirm">
                  <span>Видалити «{name}»?</span>
                  <button type="button" className="btn-danger" style={{ minHeight: 36, padding: '6px 14px' }} onClick={() => handleDelete(name)}>
                    Так
                  </button>
                  <button type="button" onClick={() => setConfirmingDelete(null)}>Ні</button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="staff-pick-btn"
                    disabled={opening}
                    onClick={() => setConfirmingStaff(name)}
                  >
                    👤 {name}
                  </button>
                  <button
                    type="button"
                    className="staff-row-icon-btn"
                    title="Перейменувати"
                    onClick={() => { setEditingStaff(name); setEditStaffName(name); }}
                  >✏️</button>
                  <button
                    type="button"
                    className="staff-row-icon-btn danger"
                    title="Видалити"
                    onClick={() => setConfirmingDelete(name)}
                  >✕</button>
                </>
              )}
            </div>
          ))}
        </div>

        {confirmingStaff && (
          <div className="modal-overlay" onClick={() => !opening && setConfirmingStaff(null)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <h2>Відкрити зміну?</h2>
              <ul className="shift-summary">
                <li><span>Співробітник</span><strong>👤 {confirmingStaff}</strong></li>
              </ul>
              <div className="modal-actions">
                <button type="button" disabled={opening} onClick={() => setConfirmingStaff(null)}>
                  Скасувати
                </button>
                <button type="button" className="btn-primary" disabled={opening} onClick={handleConfirmOpen}>
                  {opening ? 'Відкриваємо…' : 'Так, відкрити зміну'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showAddStaff ? (
          <form className="inline-form" onSubmit={handleAddStaff}>
            <input
              type="text"
              autoFocus
              placeholder="Ім'я співробітника"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="submit" disabled={!newName.trim()}>Додати</button>
          </form>
        ) : (
          <button type="button" className="small" onClick={() => setShowAddStaff(true)}>+ Додати співробітника</button>
        )}

        {error && <p className="status-deny">{error}</p>}
      </div>
    </div>
  );
}
