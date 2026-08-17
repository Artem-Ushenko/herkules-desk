// Екран «Продажі»: оплати за період, скасування, CSV.
// Історичні записи не редагуються (розділ 2): виправлення — компенсуючим
// записом; вручну дозаповнюється лише спосіб оплати (готівка/картка) —
// на практиці касир іноді натискає не той варіант.

import { useEffect, useState } from 'react';
import { STORES, getAll, put, CANCEL_REASONS } from '../db.js';
import { toISODate } from '../access.js';
import { fmtMoney, fmtDateTime, downloadCSV, paymentSplit } from '../utils.js';
import ArmedButton from '../components/ArmedButton.jsx';
import { currentShiftId } from '../shifts.js';

function defaultFrom() {
  const now = new Date();
  return toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
}

// Спосіб оплати рідко буває введений неправильно (касир натиснув не той
// варіант) — виправляється тут, як роздільна сума готівка/картка, а не лише
// перемиканням одного з двох варіантів (payment може бути й розділеним).
function MethodCell({ payment, onSaved }) {
  const target = Math.abs(payment.amount);
  const sign = payment.amount < 0 ? -1 : 1;
  const cur = paymentSplit(payment);
  const [editing, setEditing] = useState(false);
  const [cashVal, setCashVal] = useState(String(cur.cash));
  const [cardVal, setCardVal] = useState(String(cur.card));
  const [err, setErr] = useState(null);

  const startEdit = () => {
    setCashVal(String(cur.cash));
    setCardVal(String(cur.card));
    setErr(null);
    setEditing(true);
  };

  const save = async () => {
    const c = Math.round(Number(cashVal) || 0);
    const k = Math.round(Number(cardVal) || 0);
    if (c < 0 || k < 0 || c + k !== target) {
      setErr(`Сума має дорівнювати ${fmtMoney(target)}`);
      return;
    }
    await put(STORES.payments, {
      ...payment,
      method: c > 0 && k > 0 ? 'split' : (k > 0 ? 'card' : 'cash'),
      cashAmount: sign * c,
      cardAmount: sign * k
    });
    setEditing(false);
    onSaved();
  };

  if (!editing) {
    return (
      <span onClick={startEdit} title="Виправити спосіб оплати" style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}>
        {cur.cash > 0 && cur.card > 0 ? `💵 ${fmtMoney(cur.cash)} · 💳 ${fmtMoney(cur.card)}` : (cur.card > 0 ? 'картка' : 'готівка')}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input type="number" min="0" style={{ width: 64 }} value={cashVal} onChange={(e) => setCashVal(e.target.value)} title="Готівкою" />
      <input type="number" min="0" style={{ width: 64 }} value={cardVal} onChange={(e) => setCardVal(e.target.value)} title="Карткою" />
      <button type="button" className="small" onClick={save}>✓</button>
      <button type="button" className="small" onClick={() => setEditing(false)}>✕</button>
      {err && <span className="status-deny">{err}</span>}
    </span>
  );
}

export default function SalesScreen() {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(toISODate(new Date()));
  const [payments, setPayments] = useState([]);
  const [names, setNames] = useState(new Map());
  const [confirmingId, setConfirmingId] = useState(null);

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

  // Компенсуючий запис (скасування чи відновлення оплати) переносить розбивку
  // готівка/картка з вихідного платежу з протилежним знаком — інакше скасування
  // розділеної оплати «губило» одну з частин при перерахунку зміни.
  // reversalOf прив'язує запис до платежу, який він компенсує — за ним
  // контролюється, що саме вже скасовано/відновлено (щоб не скасувати двічі).
  const reversalPayment = async (p, note) => {
    const { cash, card } = paymentSplit(p);
    return {
      id: crypto.randomUUID(),
      clientId: p.clientId,
      date: new Date().toISOString(),
      amount: -p.amount,
      method: p.method,
      cashAmount: p.amount < 0 ? cash : -cash,
      cardAmount: p.amount < 0 ? card : -card,
      item: p.item,
      tariffId: p.tariffId,
      note,
      reversalOf: p.id,
      shiftId: await currentShiftId()
    };
  };

  const cancelPayment = async (p, reason) => {
    await put(STORES.payments, await reversalPayment(p, 'скасування · ' + reason));
    setConfirmingId(null);
    load();
  };

  // Відновлення оплати: ще один компенсуючий запис, що повертає суму назад —
  // сам запис скасування (розділ 2: історичні записи не редагуються) не чіпається.
  const restorePayment = async (p) => {
    await put(STORES.payments, await reversalPayment(p, 'відновлення'));
    load();
  };

  // Платежі, які вже компенсовані (скасовані або відновлені) якимось іншим
  // записом — рахується по ВСІХ платежах, а не лише у видимому періоді, щоб
  // компенсацію не можна було «загубити» зміною фільтра дат і скасувати двічі.
  const reversedIds = new Set(payments.map((p) => p.reversalOf).filter(Boolean));

  return (
    <>
      <div className="toolbar">
        <label>З: <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>По: <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <span className="spacer" />
        <b>Разом: {fmtMoney(total)}</b>
        <button type="button" onClick={() => downloadCSV(`продажі-${from}-${to}.csv`, [
          ['Дата', 'Клієнт', 'Позиція', 'Сума', 'Готівкою', 'Карткою', 'Нотатка'],
          ...visible.map((p) => {
            const { cash, card } = paymentSplit(p);
            const sign = p.amount < 0 ? -1 : 1;
            return [fmtDateTime(p.date), names.get(p.clientId) || p.clientId, p.item,
              p.amount, sign * cash, sign * card, p.note || ''];
          })
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
                {p.amount > 0 && !reversedIds.has(p.id) && confirmingId !== p.id && (
                  <button
                    type="button"
                    title="Оплата залишиться в списку, але її суму компенсує новий запис зі знаком мінус — виторг за період зменшиться. Сам запис оплати не змінюється."
                    onClick={() => setConfirmingId(p.id)}
                  >
                    Скасувати оплату
                  </button>
                )}
                {confirmingId === p.id && (
                  <div className="cancel-confirm">
                    <span>Причина скасування:</span>
                    {CANCEL_REASONS.map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        className="btn-danger"
                        style={{ minHeight: 36, padding: '6px 14px' }}
                        onClick={() => cancelPayment(p, reason)}
                      >
                        {reason[0].toUpperCase() + reason.slice(1)}
                      </button>
                    ))}
                    <button type="button" onClick={() => setConfirmingId(null)}>
                      Не скасовувати
                    </button>
                  </div>
                )}
                {p.amount < 0 && p.reversalOf && !reversedIds.has(p.id) && (
                  <ArmedButton
                    label="Відновити оплату"
                    title="Поверне суму скасованої оплати новим записом — саме скасування залишиться в списку."
                    confirmLabel="Відновити цю оплату? Суму буде повернено новим записом."
                    onConfirm={() => restorePayment(p)}
                  />
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
