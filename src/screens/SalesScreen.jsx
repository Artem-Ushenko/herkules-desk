// Екран «Продажі»: оплати за період, сторно, CSV.
// Історичні записи не редагуються (розділ 2): виправлення — сторнуючим
// записом; вручну дозаповнюється лише спосіб оплати (готівка/картка) —
// на практиці касир іноді натискає не той варіант.

import { useEffect, useState } from 'react';
import { STORES, getAll, put } from '../db.js';
import { toISODate } from '../access.js';
import { fmtMoney, fmtDateTime, downloadCSV } from '../utils.js';
import ArmedButton from '../components/ArmedButton.jsx';
import { currentShiftId } from '../shifts.js';

function defaultFrom() {
  const now = new Date();
  return toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
}

function MethodCell({ payment, onSaved }) {
  return (
    <select
      value={payment.method}
      onChange={async (e) => {
        await put(STORES.payments, { ...payment, method: e.target.value });
        onSaved();
      }}
    >
      <option value="cash">готівка</option>
      <option value="card">картка</option>
    </select>
  );
}

export default function SalesScreen() {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(toISODate(new Date()));
  const [payments, setPayments] = useState([]);
  const [names, setNames] = useState(new Map());

  const load = async () => {
    const [ps, clients] = await Promise.all([getAll(STORES.payments), getAll(STORES.clients)]);
    setPayments(ps);
    setNames(new Map(clients.map((c) => [c.id, c.name])));
  };

  useEffect(() => { load(); }, []);

  const visible = payments
    .filter((p) => { const d = p.date.slice(0, 10); return d >= from && d <= to; })
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = visible.reduce((sum, p) => sum + p.amount, 0);

  const storno = async (p) => {
    await put(STORES.payments, {
      id: crypto.randomUUID(),
      clientId: p.clientId,
      date: new Date().toISOString(),
      amount: -p.amount,
      method: p.method,
      item: p.item,
      tariffId: p.tariffId,
      note: 'сторно ' + p.id.slice(0, 8),
      shiftId: await currentShiftId()
    });
    load();
  };

  // Скасування сторно: ще один компенсуючий запис, що повертає суму назад —
  // сам запис сторно (розділ 2: історичні записи не редагуються) не чіпається.
  const undoStorno = async (p) => {
    await put(STORES.payments, {
      id: crypto.randomUUID(),
      clientId: p.clientId,
      date: new Date().toISOString(),
      amount: -p.amount,
      method: p.method,
      item: p.item,
      tariffId: p.tariffId,
      note: 'скасування сторно ' + p.id.slice(0, 8),
      shiftId: await currentShiftId()
    });
    load();
  };

  return (
    <>
      <div className="toolbar">
        <label>З: <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>По: <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <span className="spacer" />
        <b>Разом: {fmtMoney(total)}</b>
        <button type="button" onClick={() => downloadCSV(`продажі-${from}-${to}.csv`, [
          ['Дата', 'Клієнт', 'Позиція', 'Сума', 'Спосіб', 'Нотатка'],
          ...visible.map((p) => [fmtDateTime(p.date), names.get(p.clientId) || p.clientId, p.item,
            p.amount, p.method === 'cash' ? 'готівка' : 'картка', p.note || ''])
        ])}>Експорт CSV</button>
      </div>

      <table className="data-table">
        <thead>
          <tr>{['Дата', 'Клієнт', 'Позиція', 'Сума', 'Спосіб', ''].map((t) => <th key={t}>{t}</th>)}</tr>
        </thead>
        <tbody>
          {visible.map((p) => (
            <tr key={p.id}>
              <td>{fmtDateTime(p.date)}</td>
              <td><a href={'#clients/' + p.clientId}>{names.get(p.clientId) || p.clientId}</a></td>
              <td>{p.item}{p.note ? ` (${p.note})` : ''}</td>
              <td className={p.amount < 0 ? 'status-deny' : ''}>{fmtMoney(p.amount)}</td>
              <td><MethodCell payment={p} onSaved={load} /></td>
              <td>
                {p.amount > 0 && !p.note.startsWith('сторно') && (
                  <ArmedButton label="Скасувати оплату" confirmLabel="Скасувати цю оплату? Буде створено компенсуючий запис." onConfirm={() => storno(p)} />
                )}
                {p.amount < 0 && p.note.startsWith('сторно') && (
                  <ArmedButton label="Скасувати сторно" confirmLabel="Скасувати це сторно? Оплату буде відновлено новим записом." onConfirm={() => undoStorno(p)} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!visible.length && <p className="stub">Оплат за період немає</p>}
    </>
  );
}
