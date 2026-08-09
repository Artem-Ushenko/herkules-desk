// Генерація штрих-кодів у SVG без бібліотек (розділ 7).
// Основний — Code 39; EAN-8 у запасі, якщо сканер не читатиме літери.

// Code 39: 9 елементів на символ (5 штрихів, 4 проміжки), 3 з них широкі.
// n — вузький, w — широкий; порядок: штрих-проміжок-штрих-…
const CODE39 = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw',
  'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn',
  'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn', 'K': 'wnnnnnnww', 'L': 'nnwnnnnww',
  'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn',
  'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
  'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw',
  'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
  '$': 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn'
};

const WIDE = 3; // співвідношення широкий/вузький

export function code39SVG(text, { height = 40, narrow = 2 } = {}) {
  const chars = ('*' + text.toUpperCase() + '*').split('');
  const rects = [];
  let x = 0;
  for (const ch of chars) {
    const pattern = CODE39[ch];
    if (!pattern) throw new Error(`Code 39 не підтримує символ «${ch}»`);
    for (let i = 0; i < 9; i++) {
      const w = (pattern[i] === 'w' ? WIDE : 1) * narrow;
      if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
      x += w;
    }
    x += narrow; // міжсимвольний проміжок
  }
  const width = x - narrow;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" shape-rendering="crispEdges" fill="#000">${rects.join('')}</svg>`;
}

// EAN-8: тільки 7 цифр + контрольна. Літерний номер картки кодуємо цифровою
// частиною: HC0001 → 0000001 + контрольна цифра.
const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_R = EAN_L.map(p => p.split('').map(b => b === '1' ? '0' : '1').join(''));

export function ean8CheckDigit(digits7) {
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(digits7[i]) * (i % 2 === 0 ? 3 : 1);
  return String((10 - sum % 10) % 10);
}

export function ean8SVG(cardId, { height = 40, module = 2 } = {}) {
  const digits7 = cardId.replace(/\D/g, '').padStart(7, '0').slice(-7);
  const digits = digits7 + ean8CheckDigit(digits7);
  let bits = '101';
  for (let i = 0; i < 4; i++) bits += EAN_L[Number(digits[i])];
  bits += '01010';
  for (let i = 4; i < 8; i++) bits += EAN_R[Number(digits[i])];
  bits += '101';
  const rects = [];
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') rects.push(`<rect x="${i * module}" y="0" width="${module}" height="${height}"/>`);
  }
  const width = bits.length * module;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" shape-rendering="crispEdges" fill="#000">${rects.join('')}</svg>`;
}

export function barcodeSVG(type, cardId, opts) {
  return type === 'ean8' ? ean8SVG(cardId, opts) : code39SVG(cardId, opts);
}
