# Геркулес Клуб — облік клієнтів

Локальна система обліку клієнтів для міні фітнес-студії: допуск за клубною карткою, абонементи, візити, оплати, бекапи на Google Диск.

- Без бекенду: вся база — в IndexedDB браузера
- Без збірки та npm-залежностей: vanilla JS, ES-модулі
- Працює офлайн (PWA + Service Worker)
- Бекапи через File System Access API у синхронізовану папку Google Drive

## Як запустити локально

File System Access API потребує secure context, тому просте відкриття `index.html` з диска не підійде для бекапів. Запустіть будь-який статичний сервер:

```
python -m http.server 8080
```

і відкрийте `http://localhost:8080` (localhost вважається secure context).

## Як розгорнути на GitHub Pages

1. Fork або push цього репозиторію на GitHub
2. Settings → Pages → Source: гілка `main`, папка `/ (root)`
3. Через хвилину застосунок доступний за адресою `https://<user>.github.io/herkules-desk/`
4. На робочому міні-ПК: відкрити адресу в Chrome → меню → «Встановити застосунок»

Детальна інструкція розгортання на міні-ПК — у [`DEPLOY.md`](DEPLOY.md).

## Тести

Без залежностей і без збірки. Відкрийте `tests/index.html` через локальний сервер — або в Node:

```
node -e "import('./tests/access.test.js').then(async()=>{const{runAll}=await import('./tests/runner.js');const r=await runAll();console.log(r.failed?'FAILED':'OK',r.passed+'/'+(r.passed+r.failed));process.exit(r.failed?1:0)})"
```

## Ліцензія

MIT
