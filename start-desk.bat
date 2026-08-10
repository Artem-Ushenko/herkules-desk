@echo off
chcp 65001 >nul
title Геркулес Клуб — запуск робочих систем
setlocal

REM ═══════════════════════════════════════════════════════════
REM  Запуск облікових систем на стійці рецепції
REM  Локальний сервер (папка застосунку) + каса Checkbox
REM  Два ізольовані профілі Chrome + очікування Google Диска
REM  Ставиться в Планувальник завдань "при вході в систему"
REM ═══════════════════════════════════════════════════════════

REM ---- ЗАПОВНИТИ ПЕРЕД ЗАПУСКОМ -----------------------------
set "POS_URL=https://my.checkbox.ua/"
set "DRIVE=G:"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "PROFILES=C:\Herkules\profiles"
set "PORT=8080"
REM -----------------------------------------------------------

set "APP_DIR=%~dp0"
set "CRM_URL=http://localhost:%PORT%/"

REM Роздільна здатність монітора для розміщення вікон
set "MON1_X=0"
set "MON2_X=1920"
set "WIN_W=1900"
set "WIN_H=1040"

echo.
echo   ГЕРКУЛЕС КЛУБ — підготовка робочого місця
echo   ----------------------------------------
echo.

REM ── 1. Чекаємо, поки Google Диск змонтує диск ──────────────
REM Без цього застосунок стартує раніше за диск і втрачає
REM доступ до папки бекапів — доводиться вказувати її заново
echo   [1/4] Очікування Google Диска (%DRIVE%)...
set /a TRIES=0
:waitdrive
if exist "%DRIVE%\" goto driveok
set /a TRIES+=1
if %TRIES% GEQ 30 (
  echo.
  echo   ! Google Диск не змонтувався за 60 секунд.
  echo   ! Системи запустяться, але бекап писатись НЕ буде.
  echo   ! Перевірте, чи запущений Google Drive for Desktop.
  echo.
  timeout /t 8 >nul
  goto driveskip
)
timeout /t 2 >nul
goto waitdrive

:driveok
echo         Диск %DRIVE% на місці.
:driveskip

REM ── 2. Локальний сервер застосунку (build + preview) ────────
REM Обов'язково: File System Access API (бекапи) працює лише в
REM secure context — просте відкриття index.html з диска не
REM підійде. Продакшн-режим: зібраний dist/ (без HMR/source-map
REM накладних витрат), не dev-сервер. Пересобирається щоразу при
REM старті — для цього проєкту білд займає ~1с, тож дешевше
REM перестрахуватись, ніж звіряти дату dist/ проти src/.
echo   [2/4] Збірка застосунку...
if not exist "%APP_DIR%node_modules\.bin\vite.cmd" (
  echo.
  echo   ! Не знайдено node_modules\.bin\vite.cmd
  echo   ! Виконайте один раз: npm install ^(у папці застосунку^)
  echo.
  pause
  exit /b 1
)
call "%APP_DIR%node_modules\.bin\vite.cmd" build --logLevel warn
if errorlevel 1 (
  echo.
  echo   ! Збірка не вдалася — застосунок НЕ запущено.
  echo   ! Перевірте помилки вище або зверніться до розробника.
  echo.
  pause
  exit /b 1
)
echo   Запуск локального сервера (порт %PORT%)...
start "Herkules Server" /min "%APP_DIR%node_modules\.bin\vite.cmd" preview --port %PORT% --strictPort
timeout /t 2 >nul

REM ── 3. Облікова система клубу (лівий монітор) ──────────────
echo   [3/4] Запуск системи обліку клієнтів...
start "CRM" /ABOVENORMAL "%CHROME%" ^
  --user-data-dir="%PROFILES%\crm" ^
  --app="%CRM_URL%" ^
  --window-position=%MON1_X%,0 ^
  --window-size=%WIN_W%,%WIN_H% ^
  --disable-background-timer-throttling ^
  --disable-backgrounding-occluded-windows ^
  --disable-renderer-backgrounding ^
  --disable-features=CalculateNativeWinOcclusion,TranslateUI ^
  --no-first-run ^
  --no-default-browser-check

timeout /t 3 >nul

REM ── 4. Каса Checkbox (правий монітор) ──────────────────────
REM Окремий --user-data-dir = окреме дерево процесів.
REM Падіння однієї системи не зачіпає другу.
echo   [4/4] Запуск каси Checkbox...
start "POS" /ABOVENORMAL "%CHROME%" ^
  --user-data-dir="%PROFILES%\pos" ^
  --app="%POS_URL%" ^
  --window-position=%MON2_X%,0 ^
  --window-size=%WIN_W%,%WIN_H% ^
  --disable-background-timer-throttling ^
  --disable-backgrounding-occluded-windows ^
  --disable-renderer-backgrounding ^
  --disable-features=CalculateNativeWinOcclusion,TranslateUI ^
  --no-first-run ^
  --no-default-browser-check

echo.
echo   Готово. Робочі системи запущені.
echo.
echo   Для оновлення застосунку — запустіть update.bat.
echo   Для особистого користування — Firefox на панелі задач.
echo   НЕ відкривайте сторонні сайти у робочих вікнах.
echo.
timeout /t 6 >nul
endlocal
