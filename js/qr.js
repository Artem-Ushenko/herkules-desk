// Мінімальний генератор QR-кодів у SVG без бібліотек (розділ 7: дубль номера
// картки в QR). Байтовий режим, корекція M, версії 1–3 (до 44 байтів даних) —
// номер картки або коротке посилання вміщується з запасом.

// ── Поле Галуа GF(256), поліном 0x11D ──

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function gfMul(a, b) {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

function generatorPoly(ecLen) {
  let poly = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = generatorPoly(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ res.shift();
    res.push(0);
    if (factor) {
      for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return res;
}

// Версії 1–3, рівень M, один блок: [байтів даних, байтів корекції]
const VERSIONS = [
  { v: 1, data: 16, ec: 10 },
  { v: 2, data: 28, ec: 16 },
  { v: 3, data: 44, ec: 26 }
];

function buildCodewords(text) {
  const bytes = new TextEncoder().encode(text);
  const spec = VERSIONS.find(s => bytes.length <= s.data - 2);
  if (!spec) throw new Error('Задовгий текст для QR (максимум ~42 байти)');

  const bits = [];
  const pushBits = (value, count) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  pushBits(0b0100, 4);            // байтовий режим
  pushBits(bytes.length, 8);      // лічильник (8 біт для версій 1–9)
  for (const b of bytes) pushBits(b, 8);
  pushBits(0, Math.min(4, spec.data * 8 - bits.length)); // термінатор
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  }
  const PAD = [0xec, 0x11];
  for (let i = 0; data.length < spec.data; i++) data.push(PAD[i % 2]);

  return { spec, codewords: data.concat(rsEncode(data, spec.ec)) };
}

// ── Матриця ──

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0
];

function buildMatrix(version, codewords, mask) {
  const s = 17 + 4 * version;
  const m = Array.from({ length: s }, () => new Array(s).fill(0));
  const fn = Array.from({ length: s }, () => new Array(s).fill(false)); // службові модулі

  const set = (r, c, v) => { m[r][c] = v ? 1 : 0; fn[r][c] = true; };

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r, cc = c0 + c;
        if (rr < 0 || rr >= s || cc < 0 || cc >= s) continue;
        const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = inner && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(rr, cc, dark);
      }
    }
  };
  finder(0, 0);
  finder(0, s - 7);
  finder(s - 7, 0);

  for (let i = 8; i < s - 8; i++) { // синхродоріжки
    if (!fn[6][i]) set(6, i, i % 2 === 0);
    if (!fn[i][6]) set(i, 6, i % 2 === 0);
  }

  if (version >= 2) { // вирівнювальний шаблон (для v2–v6 — один, у правому нижньому)
    const center = s - 7;
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        set(center + r, center + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
      }
    }
  }

  set(s - 8, 8, 1); // темний модуль

  // Резерв під формат-інформацію
  for (let i = 0; i < 9; i++) {
    if (!fn[8][i]) set(8, i, 0);
    if (!fn[i][8]) set(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (!fn[8][s - 1 - i]) set(8, s - 1 - i, 0);
    if (!fn[s - 1 - i][8]) set(s - 1 - i, 8, 0);
  }

  // Розкладка даних: зиґзаґ парами колонок знизу вгору, колонка 6 пропускається
  const bits = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  }
  let bitIdx = 0;
  let col = s - 1;
  let row = s - 1;
  let dir = -1;
  while (col > 0) {
    if (col === 6) col--;
    for (;;) {
      for (const c of [col, col - 1]) {
        if (!fn[row][c]) {
          let bit = bits[bitIdx++] || 0;
          if (MASKS[mask](row, c)) bit ^= 1;
          m[row][c] = bit;
        }
      }
      if (row + dir < 0 || row + dir >= s) { dir = -dir; col -= 2; break; }
      row += dir;
    }
  }

  // Формат-інформація: рівень M (00) + маска, BCH(15,5), маскування 0x5412
  let fmt = mask; // ECL M = 00 у старших бітах
  let rem = fmt << 10;
  for (let i = 14; i >= 10; i--) {
    if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  }
  fmt = ((mask << 10) | rem) ^ 0x5412;

  const fmtBit = (i) => (fmt >> i) & 1;
  for (let i = 0; i <= 5; i++) m[8][i] = fmtBit(i);
  m[8][7] = fmtBit(6);
  m[8][8] = fmtBit(7);
  m[7][8] = fmtBit(8);
  for (let i = 9; i <= 14; i++) m[14 - i][8] = fmtBit(i);
  for (let i = 0; i <= 6; i++) m[s - 1 - i][8] = fmtBit(i);
  for (let i = 7; i <= 14; i++) m[8][s - 15 + i] = fmtBit(i);

  return m;
}

// Штрафні правила вибору маски (ISO 18004, 4 критерії)
function penalty(m) {
  const s = m.length;
  let score = 0;

  const runsOf = (getter) => {
    for (let i = 0; i < s; i++) {
      let run = 1;
      for (let j = 1; j < s; j++) {
        if (getter(i, j) === getter(i, j - 1)) run++;
        else { if (run >= 5) score += 3 + run - 5; run = 1; }
      }
      if (run >= 5) score += 3 + run - 5;
    }
  };
  runsOf((i, j) => m[i][j]);
  runsOf((i, j) => m[j][i]);

  for (let r = 0; r < s - 1; r++) {
    for (let c = 0; c < s - 1; c++) {
      if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) score += 3;
    }
  }

  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (getter, i, j, p) => p.every((v, k) => getter(i, j + k) === v);
  for (let i = 0; i < s; i++) {
    for (let j = 0; j <= s - 11; j++) {
      if (matches((a, b) => m[a][b], i, j, P1) || matches((a, b) => m[a][b], i, j, P2)) score += 40;
      if (matches((a, b) => m[b][a], i, j, P1) || matches((a, b) => m[b][a], i, j, P2)) score += 40;
    }
  }

  let dark = 0;
  for (const row of m) for (const v of row) dark += v;
  score += Math.floor(Math.abs((dark * 100) / (s * s) - 50) / 5) * 10;
  return score;
}

export function qrSVG(text, { module = 3, quiet = 4 } = {}) {
  const { spec, codewords } = buildCodewords(text);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = buildMatrix(spec.v, codewords, mask);
    const p = penalty(m);
    if (!best || p < best.p) best = { m, p };
  }
  const m = best.m;
  const s = m.length;
  const size = (s + quiet * 2) * module;
  const rects = [];
  for (let r = 0; r < s; r++) {
    for (let c = 0; c < s; c++) {
      if (m[r][c]) {
        rects.push(`<rect x="${(c + quiet) * module}" y="${(r + quiet) * module}" width="${module}" height="${module}"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `width="${size}" height="${size}" shape-rendering="crispEdges" fill="#000">` +
    `<rect width="${size}" height="${size}" fill="#fff"/>${rects.join('')}</svg>`;
}
