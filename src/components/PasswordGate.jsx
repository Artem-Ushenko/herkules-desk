import { useState } from 'react';

// Пароль-екран для чутливих екранів («Налаштування»). Порівнюється SHA-256-хеш
// введеного пароля з correctHash — у публічний бандл потрапляє лише хеш, не
// відкритий текст (та сама схема, що в сестринському проєкті, Геркулес Шоп/
// mini_shop_POS/src/screens/PasswordGate.jsx). Розблокування не запам'ятовується:
// App.jsx питає пароль щоразу при вході в екран заново.
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function PasswordGate({ correctHash, onUnlock, onBack, hint = 'Введіть пароль адміністратора' }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setChecking(true);
    try {
      if ((await sha256Hex(value)) === correctHash) {
        onUnlock();
      } else {
        setError(true);
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="shift-gate">
      <form className="shift-gate-card" onSubmit={handleSubmit}>
        <h1 className="gate-brand">ГЕРКУЛЕС КЛУБ</h1>
        <p className="muted">{hint}</p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(false); }}
          placeholder="Пароль"
        />
        {error && <p className="status-deny">Невірний пароль</p>}
        <button type="submit" className="btn-primary" disabled={checking}>Увійти</button>
        {onBack && (
          <button type="button" className="small" onClick={onBack}>← Назад</button>
        )}
      </form>
    </div>
  );
}
