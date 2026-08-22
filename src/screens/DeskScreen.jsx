// Екран стійки: сканування, вердикт, «у залі зараз», скасування входу.
// Один скан — перемикач: немає в залі → вхід, є в залі → вихід (розділ 5.1).

import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '../config.js';
import { STORES, get, put, getMeta, setMeta } from '../db.js';
import { evaluateAccess, formatDate, daysUntilExpiry, EXPIRY_REMINDER_DAYS } from '../access.js';
import { checkIn, checkOut, cancelCheckIn, findOpenVisit, listOpenVisits, withinUndoWindow, reopenVisit, withinCheckOutUndoWindow } from '../visits.js';
import { getCurrentShift } from '../shifts.js';
import { getExpiringSoonClients, isExpiryReminderDismissed, dismissExpiryReminder } from '../subscriptions.js';

const TYPE_LABELS = { member: 'Клієнт', guest: 'Гість' };

function formatDuration(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} хв`;
  return `${Math.floor(min / 60)} год ${min % 60} хв`;
}

function UndoButton({ lastCheckIn, onDone }) {
  const [armedAdmin, setArmedAdmin] = useState(false);

  const handleClick = async () => {
    if (!lastCheckIn) return;
    const inWindow = withinUndoWindow(lastCheckIn.visit);
    if (!inWindow && !armedAdmin) {
      setArmedAdmin(true);
      return;
    }
    await cancelCheckIn(lastCheckIn.visit, { adminOverride: !inWindow });
    onDone(lastCheckIn.clientName);
  };

  return (
    <button type="button" className={armedAdmin ? 'btn-danger' : ''} onClick={handleClick}>
      {armedAdmin ? `Минуло понад ${CONFIG.UNDO_WINDOW_MIN} хв — натисніть ще раз (дія залогується)` : 'Скасувати вхід'}
    </button>
  );
}

function UndoCheckoutButton({ lastCheckOut, onDone }) {
  const [armedAdmin, setArmedAdmin] = useState(false);

  const handleClick = async () => {
    if (!lastCheckOut) return;
    const inWindow = withinCheckOutUndoWindow(lastCheckOut.visit);
    if (!inWindow && !armedAdmin) {
      setArmedAdmin(true);
      return;
    }
    await reopenVisit(lastCheckOut.visit, { adminOverride: !inWindow });
    onDone(lastCheckOut.clientName);
  };

  return (
    <button type="button" className={armedAdmin ? 'btn-danger' : ''} onClick={handleClick}>
      {armedAdmin ? `Минуло понад ${CONFIG.UNDO_WINDOW_MIN} хв — натисніть ще раз (дія залогується)` : 'Повернути візит (клієнт ще в залі)'}
    </button>
  );
}

function UnknownCardForm({ code, onCreated }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const client = {
      id: code,
      type: 'member',
      name: name.trim(),
      phone: phone.trim(),
      birthday: '',
      isVeteran: false,
      medicalNotes: '',
      consentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      archivedAt: null,
      subscription: null
    };
    await put(STORES.clients, client);
    // Якщо відскановано картку у форматі авто-номера (HC####), підняти
    // лічильник, щоб nextCardId() пізніше не згенерував той самий номер
    // і тихо не перезаписав цього клієнта (див. herkules-cardid-collision-bug).
    const m = new RegExp(`^${CONFIG.CARD_PREFIX}(\\d+)$`).exec(code);
    if (m) {
      const n = parseInt(m[1], 10);
      const cur = await getMeta('cardCounter', 0);
      if (n > cur) await setMeta('cardCounter', n);
    }
    onCreated(client);
  };

  return (
    <form className="mini-form" onSubmit={submit}>
      <label>Створити клієнта з карткою <b>{code}</b>:</label>
      <input type="text" placeholder="Імʼя та прізвище" required value={name} onChange={(e) => setName(e.target.value)} />
      <input type="tel" placeholder="Телефон" required value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label className="consent">
        <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Згоду на обробку персональних даних підписано (обовʼязково до першого візиту)</span>
      </label>
      <button type="submit" className="btn-primary">Створити клієнта</button>
    </form>
  );
}

// Нагадування адміну «обдзвонити тих, у кого скоро закінчується абонемент» —
// з'являється одразу після відкриття зміни (ShiftGate/ShiftBox шлють подію
// herkules:shift-changed) і висить на стійці, поки не натиснуть «Всіх
// сповіщено». Прив'язане до shiftId (subscriptions.js): нова зміна — нове
// нагадування, навіть якщо список клієнтів не змінився з учора.
function ExpiryReminderBanner() {
  const [state, setState] = useState(null); // null = ще не завантажено; 'none' = нема чого показувати

  const load = async () => {
    const shift = await getCurrentShift();
    if (!shift || await isExpiryReminderDismissed(shift.id)) {
      setState('none');
      return;
    }
    const clients = await getExpiringSoonClients();
    setState(clients.length ? { shiftId: shift.id, clients } : 'none');
  };

  useEffect(() => {
    load();
    document.addEventListener('herkules:shift-changed', load);
    return () => document.removeEventListener('herkules:shift-changed', load);
  }, []);

  if (!state || state === 'none') return null;

  return (
    <div className="banner warn-banner expiry-banner">
      <div className="expiry-banner-head">
        <b>🔔 Абонементи скоро закінчуються ({state.clients.length}) — обдзвоніть і нагадайте про продовження</b>
        <button type="button" className="btn-primary" onClick={async () => {
          await dismissExpiryReminder(state.shiftId);
          setState('none');
        }}>Всіх сповіщено</button>
      </div>
      <ul className="expiry-list">
        {state.clients.map((c) => (
          <li key={c.id}>
            <a href={'#clients/' + c.id}>{c.name}</a>
            {c.phone && <span className="mono">{c.phone}</span>}
            <span>до {formatDate(c.endDate)} · {c.daysLeft === 0 ? 'сьогодні останній день' : `лишилось ${c.daysLeft} дн.`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DeskScreen() {
  const [verdict, setVerdict] = useState({ kind: 'idle' });
  const [inGym, setInGym] = useState([]);
  const [now, setNow] = useState(Date.now());
  const lastCheckInRef = useRef(null);
  const lastCheckOutRef = useRef(null);
  const scanRef = useRef(null);
  const [scanValue, setScanValue] = useState('');

  const refreshInGym = async () => {
    const open = await listOpenVisits();
    open.sort((a, b) => b.checkIn - a.checkIn);
    const withClients = await Promise.all(open.map(async (v) => ({ visit: v, client: await get(STORES.clients, v.clientId) })));
    setInGym(withClients);
  };

  const focusScan = () => scanRef.current?.focus();

  useEffect(() => {
    focusScan();
    refreshInGym();
    const tick = setInterval(() => setNow(Date.now()), 30000);
    const onChanged = () => refreshInGym();
    document.addEventListener('herkules:visits-changed', onChanged);
    return () => {
      clearInterval(tick);
      document.removeEventListener('herkules:visits-changed', onChanged);
    };
  }, []);

  useEffect(() => {
    const onClick = (e) => {
      const interactive = e.target.closest('button, a, input, select, textarea, label, form');
      if (!interactive) focusScan();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Абонемент + термін дії показуємо завжди (не лише коли він спливає) —
  // адміністратор має бачити це на кожному скані, без походу в картку клієнта.
  function visitBalanceText(client) {
    const s = client.subscription;
    if (!s) return '';
    const visitsPart = s.visitsLeft === null ? '' : ` · лишилось ${s.visitsLeft} візит(и)`;
    return `${s.title} · до ${formatDate(s.endDate)}${visitsPart}`;
  }

  async function handleScan(rawCode) {
    const code = rawCode.trim().toUpperCase();
    const client = await get(STORES.clients, code);

    if (!client) {
      setVerdict({ kind: 'deny', title: 'НЕВІДОМА КАРТКА', sub: code, unknownCode: code });
      return;
    }
    if (client.archivedAt) {
      setVerdict({ kind: 'deny', title: 'СТОП', sub: `${client.name} — картка в архіві` });
      return;
    }

    const open = await findOpenVisit(client.id);
    if (open) {
      const v = await checkOut(open);
      lastCheckOutRef.current = { visit: v, clientName: client.name };
      await refreshInGym();
      setVerdict({ kind: 'ok', title: 'ДО ПОБАЧЕННЯ', sub: `${client.name} · у залі ${formatDuration(v.checkOut - v.checkIn)}`, showUndoCheckout: true });
      return;
    }

    const decision = evaluateAccess(client);
    if (!decision.allow) {
      setVerdict({ kind: 'deny', title: 'СТОП', sub: decision.reason, name: client.name, sellClientId: client.id });
      return;
    }

    const visit = await checkIn(client);
    lastCheckInRef.current = { visit, clientName: client.name };
    await refreshInGym();

    const subInfo = visitBalanceText(client);
    // Нагадування «зателефонувати про продовження» — довший горизонт
    // (EXPIRY_REMINDER_DAYS), ніж «жовтий» вердикт допуску (WARN_DAYS у access.js):
    // клієнт може прийти зеленим («ok»), але вже потрапити в горизонт дзвінка.
    const daysLeft = client.type === 'member' ? daysUntilExpiry(client) : null;
    const reminder = daysLeft !== null && daysLeft <= EXPIRY_REMINDER_DAYS
      ? (daysLeft === 0
        ? 'Сьогодні останній день дії абонемента — нагадайте клієнту про продовження'
        : `Абонемент закінчується через ${daysLeft} дн. — нагадайте клієнту про продовження`)
      : null;

    if (decision.level === 'warn') {
      setVerdict({ kind: 'warn', title: 'ПРОХОДЬ ⚠', sub: `${client.name} · ${subInfo}`, reminder, showUndo: true });
    } else {
      const sub = client.type === 'member' ? subInfo : TYPE_LABELS[client.type];
      setVerdict({ kind: 'ok', title: 'ПРОХОДЬ', sub: `${client.name}${sub ? ' · ' + sub : ''}`, reminder, showUndo: true });
    }
  }

  const onScanKeyDown = (e) => {
    if (e.key === 'Enter' && scanValue.trim()) {
      handleScan(scanValue);
      setScanValue('');
    }
  };

  const onUndoDone = async (clientName) => {
    setVerdict({ kind: 'ok', title: 'ВХІД СКАСОВАНО', sub: `${clientName} · візит повернуто на баланс` });
    lastCheckInRef.current = null;
    await refreshInGym();
    focusScan();
  };

  const onUndoCheckoutDone = async (clientName) => {
    setVerdict({ kind: 'ok', title: 'ВІЗИТ ПОВЕРНУТО', sub: `${clientName} · клієнт лишається в залі` });
    lastCheckOutRef.current = null;
    await refreshInGym();
    focusScan();
  };

  const onClientCreated = (client) => {
    setVerdict({ kind: 'warn', title: 'СТВОРЕНО', sub: `${client.name} · без абонемента`, sellClientId: client.id });
    focusScan();
  };

  return (
    <>
      <ExpiryReminderBanner />
      <div className={'verdict' + (verdict.kind !== 'idle' ? ' ' + verdict.kind : '')}>
        {verdict.name && <div className="v-sub">{verdict.name}</div>}
        <div className="v-title">{verdict.kind === 'idle' ? 'Скануйте картку' : verdict.title}</div>
        {verdict.kind === 'idle'
          ? <div className="v-hint">Сканер працює як клавіатура: код + Enter</div>
          : (verdict.sub && <div className="v-sub">{verdict.sub}</div>)}
        {verdict.reminder && <div className="v-reminder">🔔 {verdict.reminder}</div>}
        {verdict.sellClientId && (
          <div className="v-actions">
            <a className="btn btn-primary" href={'#clients/' + verdict.sellClientId}>Продати абонемент</a>
          </div>
        )}
        {verdict.showUndo && (
          <div className="v-actions">
            <UndoButton lastCheckIn={lastCheckInRef.current} onDone={onUndoDone} />
          </div>
        )}
        {verdict.showUndoCheckout && (
          <div className="v-actions">
            <UndoCheckoutButton lastCheckOut={lastCheckOutRef.current} onDone={onUndoCheckoutDone} />
          </div>
        )}
        {verdict.unknownCode && <UnknownCardForm code={verdict.unknownCode} onCreated={onClientCreated} />}
      </div>
      <div className="scan-row">
        <input
          ref={scanRef}
          placeholder="Скануйте картку або введіть номер…"
          autoComplete="off"
          spellCheck="false"
          value={scanValue}
          onChange={(e) => setScanValue(e.target.value)}
          onKeyDown={onScanKeyDown}
        />
      </div>
      <div className="in-gym">
        <h2>У залі зараз (<span>{inGym.length}</span>)</h2>
        <div className="in-gym-grid">
          {inGym.map(({ visit: v, client }) => {
            const time = new Date(v.checkIn).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' });
            return (
              <div className="person-tile" key={v.id}>
                <a className="p-name" href={'#clients/' + v.clientId} title="Відкрити картку клієнта">{client ? client.name : v.clientId}</a>
                <div className="p-meta">зайшов о {time} · у залі {formatDuration(now - v.checkIn)}</div>
                <span className={'p-type ' + v.clientType}>{TYPE_LABELS[v.clientType] || v.clientType}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
