// Екран «Журнал»: усі візити з фільтрами, автозакриті — з позначкою, CSV.

import { useEffect, useState } from 'react';
import { CONFIG } from '../config.js';
import { STORES, getAll } from '../db.js';
import { toISODate } from '../access.js';
import { fmtDateTime, downloadCSV } from '../utils.js';

// Межа доби у звітах (3.6): доба = [OPEN_TIME, CLOSE_TIME]. Візит,
// що почався до OPEN_TIME, належить попередньому дню.
function businessDate(ts) {
  const d = new Date(ts);
  const hhmm = d.toTimeString().slice(0, 5);
  if (hhmm < CONFIG.OPEN_TIME) d.setDate(d.getDate() - 1);
  return toISODate(d);
}

function duration(v) {
  if (v.autoClosed || !v.checkOut) return '—';
  const min = Math.round((v.checkOut - v.checkIn) / 60000);
  return min < 60 ? `${min} хв` : `${Math.floor(min / 60)} год ${min % 60} хв`;
}

export default function JournalScreen() {
  const today = toISODate(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [clientQuery, setClientQuery] = useState('');
  const [visits, setVisits] = useState([]);
  const [names, setNames] = useState(new Map());

  useEffect(() => {
    (async () => {
      const [vs, clients] = await Promise.all([getAll(STORES.visits), getAll(STORES.clients)]);
      setVisits(vs);
      setNames(new Map(clients.map((c) => [c.id, c.name])));
    })();
  }, []);

  const visible = visits.filter((v) => {
    const d = businessDate(v.checkIn);
    if (d < from || d > to) return false;
    if (clientQuery) {
      const q = clientQuery.toLowerCase();
      const name = (names.get(v.clientId) || '').toLowerCase();
      if (!name.includes(q) && !v.clientId.toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => b.checkIn - a.checkIn);

  const autoClosed = visible.filter((v) => v.autoClosed).length;

  return (
    <>
      <div className="toolbar">
        <label>З: <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>По: <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <input className="search" placeholder="Клієнт або картка" value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} />
        <span className="spacer" />
        <span className="muted">Візитів: {visible.length}{autoClosed ? ` · автозакритих: ${autoClosed}` : ''}</span>
        <button type="button" onClick={() => downloadCSV(`журнал-${from}-${to}.csv`, [
          ['День', 'Вхід', 'Вихід', 'Тривалість', 'Клієнт', 'Картка', 'Тип', 'Абонемент', 'Автозакрито'],
          ...visible.map((v) => [businessDate(v.checkIn), fmtDateTime(v.checkIn),
            v.checkOut ? fmtDateTime(v.checkOut) : '', duration(v), names.get(v.clientId) || '', v.clientId,
            v.clientType, v.subscriptionTitle, v.autoClosed ? 'так' : ''])
        ])}>Експорт CSV</button>
      </div>

      <table className="data-table">
        <thead>
          <tr>{['Вхід', 'Вихід', 'Тривалість', 'Клієнт', 'Тип', 'Абонемент'].map((t) => <th key={t}>{t}</th>)}</tr>
        </thead>
        <tbody>
          {visible.map((v) => (
            <tr key={v.id}>
              <td>{fmtDateTime(v.checkIn)}</td>
              {/* Автозакриті — показник дисципліни сканування, підсвічуються окремо (3.5) */}
              <td>{v.autoClosed
                ? <span className="badge med">автозакрито 23:00</span>
                : (v.checkOut ? new Date(v.checkOut).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' }) : <span className="status-ok">у залі</span>)}</td>
              <td>{duration(v)}</td>
              <td><a href={'#clients/' + v.clientId}>{names.get(v.clientId) || v.clientId}</a></td>
              <td>{v.clientType === 'member' ? 'клієнт' : v.clientType === 'guest' ? 'гість' : 'тренер'}</td>
              <td className="muted">{v.subscriptionTitle}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!visible.length && <p className="stub">Візитів за період немає</p>}
    </>
  );
}
