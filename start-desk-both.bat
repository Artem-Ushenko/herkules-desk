@echo off
chcp 65001 >nul
title Геркулес — запуск двох облікових систем
setlocal

REM ═══════════════════════════════════════════════════════════
REM  Загальний запуск: Геркулес Клуб (зал) + Геркулес Шоп (магазин
REM  спортхарчування) — дві незалежні системи на одному ПК/стійці,
REM  працюють одночасно, кожна у своєму ізольованому профілі Chrome
REM  і своєму вікні. Ставиться в Планувальник завдань "при вході
REM  в систему".
REM
REM  Це ШАБЛОН — розділ «Геркулес Шоп» нижче містить заглушки
REM  (⚠️ уточнити), бо той проєкт розгортається на іншому ПК і його
REM  реальний шлях/команда запуску тут ще не відомі. Заповнити на
REM  місці, за зразком install/run.bat самого mini-shop-pos.
REM ═══════════════════════════════════════════════════════════

REM ---- ЗАПОВНИТИ ПЕРЕД ЗАПУСКОМ -----------------------------

REM -- Геркулес Клуб (зал), цей репозиторій --
set "CLUB_DIR=%~dp0"
set "CLUB_PORT=8080"

REM -- Геркулес Шоп (магазин спортхарчування), окремий репозиторій mini-shop-pos --
set "SHOP_DIR=C:\ШЛЯХ\ДО\mini-shop-pos"          & REM ⚠️ уточнити на цільовому ПК
set "SHOP_START_CMD=run.bat"                      & REM ⚠️ уточнити — install/run.bat, npm run dev, чи інше
set "SHOP_PORT=5173"                              & REM ⚠️ уточнити — порт, який видає Vite (strictPort у vite.config.js)

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "PROFILES=C:\Herkules\profiles"
REM -----------------------------------------------------------

REM Роздільна здатність монітора для розміщення вікон
set "MON1_X=0"
set "MON2_X=1920"
set "WIN_W=1900"
set "WIN_H=1040"

echo.
echo   ГЕРКУЛЕС — підготовка двох робочих систем
echo   ------------------------------------------
echo.

REM ── 1. Геркулес Клуб: збірка + локальний сервер ────────────
echo   [1/4] Збірка та запуск «Геркулес Клуб»...
if not exist "%CLUB_DIR%node_modules\.bin\vite.cmd" (
  echo.
  echo   ! Не знайдено node_modules\.bin\vite.cmd у %CLUB_DIR%
  echo   ! Виконайте один раз: npm install ^(у папці Клубу^)
  echo.
  pause
  exit /b 1
)
call "%CLUB_DIR%node_modules\.bin\vite.cmd" build --logLevel warn
if errorlevel 1 (
  echo.
  echo   ! Збірка «Геркулес Клуб» не вдалася — систему НЕ запущено.
  echo.
  pause
  exit /b 1
)
start "Herkules Club Server" /min "%CLUB_DIR%node_modules\.bin\vite.cmd" preview --port %CLUB_PORT% --strictPort

REM ── 2. Геркулес Шоп: запуск сервера ─────────────────────────
REM ⚠️ Заглушка: SHOP_START_CMD виконується як є в папці SHOP_DIR.
REM Якщо це npm-скрипт (npm run dev/build+preview) — переконатись,
REM що SHOP_PORT відповідає тому, що реально видасть Vite.
echo   [2/4] Запуск «Геркулес Шоп»...
if not exist "%SHOP_DIR%" (
  echo.
  echo   ! SHOP_DIR не існує: %SHOP_DIR%
  echo   ! Заповніть шлях до mini-shop-pos на початку файлу.
  echo.
  pause
  exit /b 1
)
start "Herkules Shop Server" /min cmd /c "cd /d "%SHOP_DIR%" && %SHOP_START_CMD%"

REM ── 3. Чекаємо, поки обидва сервери піднімуться ─────────────
echo   [3/4] Очікування серверів...
set /a TRIES=0
:waitservers
curl -s -o nul "http://localhost:%CLUB_PORT%/" 2>nul
set "CLUBOK=%errorlevel%"
curl -s -o nul "http://localhost:%SHOP_PORT%/" 2>nul
set "SHOPOK=%errorlevel%"
if "%CLUBOK%"=="0" if "%SHOPOK%"=="0" goto serversok
set /a TRIES+=1
if %TRIES% GEQ 20 (
  echo.
  echo   ! Один із серверів не відповів за 20с — відкриваю вікна все одно,
  echo   ! перевірте вручну, чи все підняли.
  echo.
  goto serversok
)
timeout /t 1 >nul
goto waitservers
:serversok

REM ── 4. Два вікна Chrome, кожне у своєму профілі ─────────────
echo   [4/4] Запуск вікон Chrome...
start "Herkules Club" /ABOVENORMAL "%CHROME%" ^
  --user-data-dir="%PROFILES%\club" ^
  --app="http://localhost:%CLUB_PORT%/" ^
  --window-position=%MON1_X%,0 ^
  --window-size=%WIN_W%,%WIN_H% ^
  --disable-background-timer-throttling ^
  --disable-backgrounding-occluded-windows ^
  --disable-renderer-backgrounding ^
  --disable-features=CalculateNativeWinOcclusion,TranslateUI ^
  --no-first-run ^
  --no-default-browser-check

timeout /t 2 >nul

start "Herkules Shop" /ABOVENORMAL "%CHROME%" ^
  --user-data-dir="%PROFILES%\shop" ^
  --app="http://localhost:%SHOP_PORT%/" ^
  --window-position=%MON2_X%,0 ^
  --window-size=%WIN_W%,%WIN_H% ^
  --disable-background-timer-throttling ^
  --disable-backgrounding-occluded-windows ^
  --disable-renderer-backgrounding ^
  --disable-features=CalculateNativeWinOcclusion,TranslateUI ^
  --no-first-run ^
  --no-default-browser-check

echo.
echo   Готово. Обидві системи запущені.
echo.
timeout /t 6 >nul
endlocal
