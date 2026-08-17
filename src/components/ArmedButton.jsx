import { useEffect, useRef, useState } from 'react';

// Двокрокове підтвердження без window.confirm: перший клік озброює кнопку,
// другий — виконує дію. Автоматично роззброюється через 5с.
export default function ArmedButton({ label, confirmLabel, onConfirm, className = 'btn-danger', title }) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleClick = async () => {
    if (!armed) {
      setArmed(true);
      timerRef.current = setTimeout(() => setArmed(false), 5000);
      return;
    }
    clearTimeout(timerRef.current);
    setArmed(false);
    await onConfirm();
  };

  return (
    <button type="button" className={armed ? className : ''} title={armed ? undefined : title} onClick={handleClick}>
      {armed ? confirmLabel : label}
    </button>
  );
}
