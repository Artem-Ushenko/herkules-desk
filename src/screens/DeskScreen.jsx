// Екран стійки: сканування, вердикт, «у залі зараз», скасування входу.
// Один скан — перемикач: немає в залі → вхід, є в залі → вихід (розділ 5.1).

import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '../config.js';
import { STORES, get, put, getMeta, setMeta } from '../db.js';
import { evaluateAccess } from '../access.js';
import { checkIn, checkOut, cancelCheckIn, findOpenVisit, listOpenVisits, withinUndoWindow } from '../visits.js';

const TYPE_LABELS = { member: 'Клієнт', guest: 'Гість орендаря', trainer: 'Тренер' };

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
      hostTrainerId: '',
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

export default function DeskScreen() {
  const [verdict, setVerdict] = useState({ kind: 'idle' });
  const [inGym, setInGym] = useState([]);
  const [now, setNow] = useState(Date.now());
  const lastCheckInRef = useRef(null);
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

  function visitBalanceText(client) {
    const s = client.subscription;
    if (!s) return '';
    if (s.visitsLeft === null) return s.title;
    return `${s.title} · лишилось ${s.visitsLeft} візит(и)`;
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
      await refreshInGym();
      setVerdict({ kind: 'ok', title: 'ДО ПОБАЧЕННЯ', sub: `${client.name} · у залі ${formatDuration(v.checkOut - v.checkIn)}` });
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
    if (decision.level === 'warn') {
      setVerdict({ kind: 'warn', title: 'ПРОХОДЬ ⚠', sub: `${client.name} · ${decision.reason}`, showUndo: true });
    } else {
      const sub = client.type === 'member' ? subInfo : TYPE_LABELS[client.type];
      setVerdict({ kind: 'ok', title: 'ПРОХОДЬ', sub: `${client.name}${sub ? ' · ' + sub : ''}`, showUndo: true });
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

  const onClientCreated = (client) => {
    setVerdict({ kind: 'warn', title: 'СТВОРЕНО', sub: `${client.name} · без абонемента`, sellClientId: client.id });
    focusScan();
  };

  return (
    <>
      <div className={'verdict' + (verdict.kind !== 'idle' ? ' ' + verdict.kind : '')}>
        {verdict.name && <div className="v-sub">{verdict.name}</div>}
        <div className="v-title">{verdict.kind === 'idle' ? 'Скануйте картку' : verdict.title}</div>
        {verdict.kind === 'idle'
          ? <div className="v-hint">Сканер працює як клавіатура: код + Enter</div>
          : (verdict.sub && <div className="v-sub">{verdict.sub}</div>)}
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
                <div className="p-name">{client ? client.name : v.clientId}</div>
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
