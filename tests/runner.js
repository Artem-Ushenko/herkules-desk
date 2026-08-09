// Мінімальний тест-раннер без залежностей. Працює і в браузері, і в Node.

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assertEqual(actual, expected, hint = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${hint ? hint + ': ' : ''}очікувалось ${e}, отримано ${a}`);
  }
}

export function assert(cond, hint = 'умова не виконана') {
  if (!cond) throw new Error(hint);
}

export async function runAll() {
  const results = [];
  for (const t of tests) {
    try {
      await t.fn();
      results.push({ name: t.name, ok: true });
    } catch (err) {
      results.push({ name: t.name, ok: false, error: err.message });
    }
  }
  return {
    results,
    passed: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length
  };
}
