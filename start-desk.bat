@echo off
chcp 65001 >nul
title Геркулес Клуб — запуск робочої системи
setlocal

REM ═══════════════════════════════════════════════════════════
REM  Запуск облікової системи клубу на стійці рецепції
REM  Локальний сервер (папка застосунку) + очікування Google Диска
REM  Окремий профіль Chrome у режимі застосунку (--app).
REM  Ставиться в Планувальник завдань "при вході в систему".
REM ═══════════════════════════════════════════════════════════

REM ---- ЗАПОВНИТИ ПЕРЕД ЗАПУСКОМ -----------------------------
set "DRIVE=G:"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "PROFILES=C:\Herkules\profiles"
set "PORT=8080"
REM -----------------------------------------------------------

set "APP_DIR=%~dp0"
set "CRM_URL=http://localhost:%PORT%/"

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
  echo   ! Система запуститься, але бекап писатись НЕ буде.
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

REM ── 2. Щотижневе очищення старих бекапів (лише в неділю) ────
if exist "%APP_DIR%cleanup-backups.bat" call "%APP_DIR%cleanup-backups.bat"

REM ── 3. Локальний сервер застосунку (build + preview) ────────
REM Обов'язково: File System Access API (бекапи) працює лише в
REM secure context — просте відкриття index.html з диска не
REM підійде. Продакшн-режим: зібраний dist/ (без HMR/source-map
REM накладних витрат), не dev-сервер. Пересобирається щоразу при
REM старті — для цього проєкту білд займає ~1с, тож дешевше
REM перестрахуватись, ніж звіряти дату dist/ проти src/.
echo   [3/4] Збірка застосунку...
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

REM ── 4. Облікова система клубу ───────────────────────────────
echo   [4/4] Запуск системи обліку клієнтів...
REM --window-position разом з --start-maximized конфліктують — Chrome
REM відкриває звичайне (не розгорнуте) вікно. Без позиції --start-maximized
REM відкриває вікно на весь робочий екран основного монітора самостійно.
start "CRM" /ABOVENORMAL "%CHROME%" ^
  --user-data-dir="%PROFILES%\crm" ^
  --app="%CRM_URL%" ^
  --start-maximized ^
  --disable-background-timer-throttling ^
  --disable-backgrounding-occluded-windows ^
  --disable-renderer-backgrounding ^
  --disable-features=CalculateNativeWinOcclusion,TranslateUI ^
  --no-first-run ^
  --no-default-browser-check

echo.
echo   Готово. Робоча система запущена.
echo.
echo   Для оновлення застосунку — запустіть update.bat.
echo   Фіскалізацію чеків (Checkbox) відкривайте окремо, вручну —
echo   цей скрипт її більше не запускає.
echo   НЕ відкривайте сторонні сайти у робочому вікні.
echo.
timeout /t 6 >nul
endlocal
