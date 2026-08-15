// Екран «Клієнти»: реєстр із фільтрами і картка клієнта.
// Маршрути: #clients — список, #clients/HC0001 — картка, #clients/new — форма.

import { useEffect, useState } from 'react';
import { CONFIG } from '../config.js';
import { STORES, get, getAll, getAllByIndex, put, remove, nextCardId } from '../db.js';
import { evaluateAccess, formatDate, toISODate } from '../access.js';
import { listOpenVisits } from '../visits.js';
import { sellSubscription, freezeSubscription, unfreezeSubscription, FREEZE_REASONS } from '../subscriptions.js';
import { barcodeSVG } from '../barcode.js';
import { qrSVG } from '../qr.js';
import { fmtMoney, fmtDateTime, downloadCSV } from '../utils.js';
import ArmedButton from '../components/ArmedButton.jsx';

const TYPE_LABELS = { member: 'Клієнт', guest: 'Гість орендаря', trainer: 'Тренер' };

const FILTERS = {
  all: 'Усі',
  active: 'Активні',
  expiring: 'Спливають',
  expired: 'Прострочені',
  veterans: 'Ветерани',
  guests: 'Гості орендаря',
  ingym: 'Зараз у залі',
  archived: 'Архів'
};

function subStatus(c) {
  if (c.type !== 'member') return { text: '—', level: 'none' };
  if (!c.subscription) return { text: 'Немає', level: 'deny' };
  const d = evaluateAccess(c);
  const s = c.subscription;
  if (s.freeze.active) return { text: `Заморожено з ${formatDate(s.freeze.since)}`, level: 'warn' };
  if (!d.allow) return { text: d.reason, level: 'deny' };
  const visits = s.visitsLeft === null ? 'безліміт' : s.visitsLeft + ' візит(и)';
  return { text: `до ${formatDate(s.endDate)} · ${visits}`, level: d.level === 'warn' ? 'warn' : 'ok' };
}

function exportClientsCSV(clients, withMedical) {
  const head = ['Картка', 'Імʼя', 'Телефон', 'Тип', 'Ветеран', 'Дата народження', 'Згода з', 'Абонемент', 'Діє до', 'Візитів'];
  if (withMedical) head.push('Медичні нотатки');
  const rows = [head];
  for (const c of clients) {
    const r = [c.id, c.name, c.phone, TYPE_LABELS[c.type], c.isVeteran ? 'так' : '', c.birthday,
      formatDate(c.consentAt?.slice(0, 10)), c.subscription?.title || '', formatDate(c.subscription?.endDate || ''),
      c.subscription ? (c.subscription.visitsLeft ?? 'безліміт') : ''];
    if (withMedical) r.push(c.medicalNotes);
    rows.push(r);
  }
  downloadCSV(withMedical ? 'клієнти-з-меднотатками.csv' : 'клієнти.csv', rows);
}

// Друк клубної картки 86×54 мм (розділ 7) — імперативно, поза React-деревом
function printCard(client) {
  const area = document.getElementById('print-area');
  area.innerHTML = `
    <div class="club-card">
      <div class="cc-club">${CONFIG.CLUB_NAME}</div>
      <div class="cc-name"></div>
      <div class="cc-barcode">${barcodeSVG(CONFIG.BARCODE_TYPE, client.id, { height: 46 })}</div>
      <div class="cc-number">${client.id}</div>
      <div class="cc-qr">${qrSVG(client.id)}</div>
      <div class="cc-address">${CONFIG.CLUB_ADDRESS}</div>
    </div>
  `;
  area.querySelector('.cc-name').textContent = client.name;
  window.print();
}

export default function ClientsScreen({ param }) {
  if (param === 'new') {
    return <ClientForm key="new" client={null} onDone={(saved) => { location.hash = '#clients/' + saved.id; }} />;
  }
  if (param) {
    return <ClientCard key={param} id={param} />;
  }
  return <ClientsList key="list" />;
}

function ClientsList() {
  const [clients, setClients] = useState([]);
  const [inGymIds, setInGymIds] = useState(new Set());
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      const [cs, open] = await Promise.all([getAll(STORES.clients), listOpenVisits()]);
      setClients(cs);
      setInGymIds(new Set(open.map((v) => v.clientId)));
    })();
  }, []);

  const visible = clients.filter((c) => {
    if (filter !== 'archived' && c.archivedAt) return false;
    const d = () => evaluateAccess(c);
    switch (filter) {
      case 'active': return c.type === 'member' && d().allow;
      case 'expiring': return c.type === 'member' && d().level === 'warn';
      case 'expired': return c.type === 'member' && !d().allow;
      case 'veterans': return c.isVeteran;
      case 'guests': return c.type === 'guest';
      case 'ingym': return inGymIds.has(c.id);
      case 'archived': return !!c.archivedAt;
      default: return true;
    }
  }).filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.id.toLowerCase().includes(q);
  }).sort((a, b) => a.name.localeCompare(b.name, 'uk'));

  return (
    <>
      <div className="toolbar">
        <input className="search" placeholder="Пошук: імʼя / телефон / картка" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {Object.entries(FILTERS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <a className="btn btn-primary" href="#clients/new">+ Додати клієнта</a>
        <button type="button" onClick={() => exportClientsCSV(visible, false)}>Експорт CSV</button>
        {/* Меднотатки — дані про здоровʼя: окрема кнопка з попередженням (розділ 8) */}
        <ArmedButton label="Експорт із меднотатками" confirmLabel="⚠ Це чутливі дані про здоровʼя — точно?" onConfirm={() => exportClientsCSV(visible, true)} />
      </div>

      <table className="data-table">
        <thead>
          <tr>{['Картка', 'Імʼя', 'Телефон', 'Тип', 'Абонемент', ''].map((t) => <th key={t}>{t}</th>)}</tr>
        </thead>
        <tbody>
          {visible.map((c) => {
            const st = subStatus(c);
            return (
              <tr key={c.id} onClick={() => { location.hash = '#clients/' + c.id; }}>
                <td className="mono">{c.id}</td>
                <td>
                  <b>{c.name}</b>
                  {c.isVeteran && <span className="badge vet">ветеран</span>}
                  {c.medicalNotes && <span className="badge med" title="Є медичні нотатки">⚕</span>}
                </td>
                <td>{c.phone}</td>
                <td>{TYPE_LABELS[c.type]}</td>
                <td className={'status-' + st.level}>{st.text}</td>
                <td>{inGymIds.has(c.id) ? '🟢 у залі' : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!visible.length && <p className="stub">Нікого не знайдено</p>}
    </>
  );
}

function Flash({ flash }) {
  if (!flash) return null;
  return <div className={'banner ' + (flash.isError ? 'warn-banner' : 'ok-banner')}>{flash.message}</div>;
}

function ClientCard({ id }) {
  const [client, setClient] = useState(undefined); // undefined = завантаження
  const [editing, setEditing] = useState(false);
  const [visits, setVisits] = useState([]);
  const [payments, setPayments] = useState([]);
  const [tariffs, setTariffs] = useState([]);
  const [flash, setFlash] = useState(null);
  const [tariffId, setTariffId] = useState('');
  const [method, setMethod] = useState('cash');
  const [startDate, setStartDate] = useState(toISODate(new Date()));
  const [freezeReason, setFreezeReason] = useState('service');

  const flashMsg = (message, isError = false) => {
    setFlash({ message, isError });
    setTimeout(() => setFlash(null), 4000);
  };

  const load = async () => {
    const c = await get(STORES.clients, id);
    setClient(c);
    if (!c) return;
    const [vs, ps, ts] = await Promise.all([
      getAllByIndex(STORES.visits, 'clientId', id),
      getAllByIndex(STORES.payments, 'clientId', id),
      getAll(STORES.tariffs)
    ]);
    vs.sort((a, b) => b.checkIn - a.checkIn);
    ps.sort((a, b) => b.date.localeCompare(a.date));
    setVisits(vs);
    setPayments(ps);
    setTariffs(ts);
  };

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (client === undefined) return null;

  if (client === null) {
    return (
      <ClientForm client={null} presetId={id} onDone={(saved) => {
        if (saved.id === id) load();
        else location.hash = '#clients/' + saved.id;
      }} />
    );
  }

  if (editing) {
    return <ClientForm client={client} onDone={() => { setEditing(false); load(); }} onBack={() => setEditing(false)} />;
  }

  const s = client.subscription;
  const decision = client.type === 'member' && s ? evaluateAccess(client) : null;
  const available = tariffs.filter((t) => !t.forVeterans || client.isVeteran);

  return (
    <>
      <div className="card-head">
        <a href="#clients" className="btn">← Реєстр</a>
        <h1>{client.name} <span className="mono muted">{client.id}</span></h1>
        <span className="badge">{TYPE_LABELS[client.type]}</span>
        {client.isVeteran && <span className="badge vet">ветеран</span>}
        {client.archivedAt && <span className="badge med">в архіві</span>}
        <span className="spacer" />
        <button type="button" onClick={() => printCard(client)}>🖨 Друк картки</button>
        <button type="button" className="btn" onClick={() => setEditing(true)}>Редагувати</button>
      </div>

      {/* Медичні нотатки — ПЕРШИМИ: тренер має побачити обмеження до заняття (5.2) */}
      <div className={'medical' + (client.medicalNotes ? ' has-notes' : '')}>
        <b>⚕ Медичні нотатки: </b>{client.medicalNotes || 'немає'}
      </div>

      {!client.consentAt && (
        <div className="banner warn-banner">
          ⚠ Згоду на обробку персональних даних не зафіксовано — обовʼязково до першого візиту.{' '}
          <button type="button" className="btn-primary" onClick={async () => {
            const updated = { ...client, consentAt: new Date().toISOString() };
            await put(STORES.clients, updated);
            load();
          }}>Зафіксувати згоду</button>
        </div>
      )}

      <div className="card-grid">
        <div className="box">
          <h2>Абонемент</h2>
          <Flash flash={flash} />
          {client.type !== 'member' ? (
            <p className="muted">
              {client.type === 'guest'
                ? 'Гість орендаря: платить напряму тренеру, абонемент не потрібен, гроші не проходять через клуб.'
                : 'Тренер-орендар: доступ без абонемента.'}
            </p>
          ) : s ? (
            <>
              <div className={'sub-info status-' + (s.freeze.active || !decision.allow ? 'deny' : decision.level)}>
                <div className="sub-title">{s.title}</div>
                <div>Діє: {formatDate(s.startDate)} — {formatDate(s.endDate)}</div>
                <div>{s.visitsLeft === null ? 'Безліміт' : `Візитів: ${s.visitsLeft} з ${s.visitsTotal}`}</div>
                {s.freeze.active
                  ? <div>❄ Заморожено з {formatDate(s.freeze.since)} ({FREEZE_REASONS[s.freeze.reason]})</div>
                  : <div className="muted">Заморозка: використано {s.freeze.daysUsed} з {CONFIG.MAX_FREEZE_DAYS} дн. (служба — без ліміту)</div>}
              </div>
              {s.freeze.active ? (
                <button type="button" className="btn-primary" onClick={async () => {
                  await unfreezeSubscription(client);
                  load();
                }}>☀ Розморозити</button>
              ) : (
                <div className="inline-form">
                  <select value={freezeReason} onChange={(e) => setFreezeReason(e.target.value)}>
                    {Object.entries(FREEZE_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <button type="button" onClick={async () => {
                    try {
                      await freezeSubscription(client, freezeReason);
                      load();
                    } catch (err) { flashMsg(err.message, true); }
                  }}>❄ Заморозити</button>
                </div>
              )}
            </>
          ) : (
            <p className="muted">Немає абонемента</p>
          )}

          {client.type === 'member' && (
            <>
              <h3>{s ? 'Продати новий' : 'Продати абонемент'}</h3>
              {!tariffs.length ? (
                <p className="muted">Немає тарифів — додайте у <a href="#settings">Налаштуваннях</a></p>
              ) : (
                <div className="sell-form">
                  <select value={tariffId || available[0]?.id || ''} onChange={(e) => setTariffId(e.target.value)}>
                    {available.map((t) => (
                      <option key={t.id} value={t.id}>{t.title} — {fmtMoney(t.price)} ({t.visits ?? 'безліміт'} віз., {t.days} дн.)</option>
                    ))}
                  </select>
                  <select value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="cash">Готівка</option>
                    <option value="card">Картка</option>
                  </select>
                  <label>Початок: <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
                  <button type="button" className="btn-primary" onClick={async () => {
                    const tariff = available.find((t) => t.id === (tariffId || available[0]?.id));
                    if (!tariff) return;
                    await sellSubscription(client, tariff, { startDate, method });
                    load();
                  }}>Продати</button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="box">
          <h2>Візити ({visits.length})</h2>
          <table className="data-table compact">
            <tbody>
              {visits.slice(0, 15).map((v) => (
                <tr key={v.id}>
                  <td>{fmtDateTime(v.checkIn)}</td>
                  <td>{v.checkOut ? '→ ' + new Date(v.checkOut).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' }) : 'у залі'}</td>
                  <td>{v.autoClosed && <span className="badge med">автозакрито</span>}</td>
                  <td className="muted">{v.subscriptionTitle}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Оплати ({payments.length})</h2>
          <table className="data-table compact">
            <tbody>
              {payments.slice(0, 15).map((p) => (
                <tr key={p.id}>
                  <td>{fmtDateTime(p.date)}</td>
                  <td>{p.item}</td>
                  <td className={p.amount < 0 ? 'status-deny' : ''}>{fmtMoney(p.amount)}</td>
                  <td className="muted">{p.method === 'cash' ? 'готівка' : 'картка'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="box danger-zone">
        {client.archivedAt ? (
          <button type="button" onClick={async () => { await put(STORES.clients, { ...client, archivedAt: null }); load(); }}>Повернути з архіву</button>
        ) : (
          <button type="button" onClick={async () => { await put(STORES.clients, { ...client, archivedAt: new Date().toISOString() }); load(); }}>В архів</button>
        )}
        {/* Повне видалення разом з історією — вимога розділу 8 про персональні дані */}
        <ArmedButton
          label="Видалити назавжди"
          confirmLabel="⚠ Видалити клієнта і ВСЮ історію? Це незворотно"
          onConfirm={async () => {
            for (const v of visits) await remove(STORES.visits, v.id);
            for (const p of payments) await remove(STORES.payments, p.id);
            await remove(STORES.clients, id);
            location.hash = '#clients';
          }}
        />
      </div>
    </>
  );
}

function ClientForm({ client, presetId = '', onDone, onBack }) {
  const isNew = !client;
  const c = client || {
    id: presetId, type: 'member', name: '', phone: '', birthday: '', isVeteran: false,
    medicalNotes: '', consentAt: '', hostTrainerId: '', createdAt: '', archivedAt: null, subscription: null
  };
  const [id, setId] = useState(c.id);
  const [type, setType] = useState(c.type);
  const [name, setName] = useState(c.name);
  const [phone, setPhone] = useState(c.phone);
  const [birthday, setBirthday] = useState(c.birthday);
  const [isVeteran, setIsVeteran] = useState(c.isVeteran);
  const [medicalNotes, setMedicalNotes] = useState(c.medicalNotes);
  const [consent, setConsent] = useState(!!c.consentAt);
  const [hostTrainerId, setHostTrainerId] = useState(c.hostTrainerId);
  const [trainers, setTrainers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const all = await getAll(STORES.clients);
      setTrainers(all.filter((x) => x.type === 'trainer' && !x.archivedAt));
    })();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    let finalId = id.trim().toUpperCase();
    if (isNew) {
      if (!finalId) finalId = await nextCardId(CONFIG.CARD_PREFIX);
      else if (await get(STORES.clients, finalId)) {
        setError(`Картка ${finalId} вже зайнята`);
        return;
      }
    } else {
      finalId = c.id;
    }
    const updated = {
      ...c,
      id: finalId,
      type,
      name: name.trim(),
      phone: phone.trim(),
      birthday,
      isVeteran,
      medicalNotes: medicalNotes.trim(),
      consentAt: consent ? (c.consentAt || new Date().toISOString()) : '',
      hostTrainerId: type === 'guest' ? hostTrainerId : '',
      createdAt: c.createdAt || new Date().toISOString()
    };
    await put(STORES.clients, updated);
    onDone(updated);
  };

  return (
    <>
      <div className="card-head">
        {onBack ? (
          <button type="button" className="btn" onClick={onBack}>← Назад</button>
        ) : (
          <a href={isNew ? '#clients' : '#clients/' + c.id} className="btn">← Назад</a>
        )}
        <h1>{isNew ? 'Новий клієнт' : 'Редагування: ' + c.name}</h1>
      </div>
      {error && <div className="banner warn-banner">{error}</div>}
      <form className="edit-form" onSubmit={submit}>
        <label className="form-row">Номер картки
          <input type="text" value={id} disabled={!isNew} placeholder="авто" onChange={(e) => setId(e.target.value)} />
        </label>
        <label className="form-row">Тип
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="form-row">Імʼя та прізвище *
          <input type="text" value={name} required onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="form-row">Телефон
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="form-row">Дата народження
          <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
        </label>
        <label className="form-row check">
          <input type="checkbox" checked={isVeteran} onChange={(e) => setIsVeteran(e.target.checked)} /> Ветеран
        </label>
        <label className="form-row">⚕ Медичні нотатки
          <textarea rows={3} placeholder="Травми, обмеження — напр., «грижа L4–L5, без осьового навантаження»" value={medicalNotes} onChange={(e) => setMedicalNotes(e.target.value)} />
        </label>
        {type === 'guest' && (
          <label className="form-row">До кого прийшов
            <select value={hostTrainerId} onChange={(e) => setHostTrainerId(e.target.value)}>
              <option value="">— оберіть тренера —</option>
              {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        <label className="form-row check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Згоду на обробку персональних даних підписано
        </label>
        <button type="submit" className="btn-primary">{isNew ? 'Створити' : 'Зберегти'}</button>
      </form>
    </>
  );
}
