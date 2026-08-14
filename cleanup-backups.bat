@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ═══════════════════════════════════════════════════════════
REM  Щотижневе очищення старих бекапів
REM  Викликається з start-desk.bat при КОЖНОМУ вході в систему,
REM  але реально видаляє файли лише в неділю — щоб тека з
REM  бекапами на Google Диску не засмічувалась, навіть якщо
REM  вбудована в застосунок ротація (BACKUP_KEEP у config.js) не
REM  встигає спрацювати через нерегулярну роботу кіоска.
REM  Лишає останні KEEP файлів, найновіший включно.
REM ═══════════════════════════════════════════════════════════

REM ---- ЗАПОВНИТИ ПЕРЕД ЗАПУСКОМ -------------------------------
REM Шлях має збігатись з папкою, обраною в застосунку через
REM "Обрати папку для бекапів" у Налаштуваннях (розділ 6).
set "BACKUP_DIR=G:\Herkules\backups"
set "KEEP=5"
REM --------------------------------------------------------------

REM DayOfWeek.value__: Sunday=0 — не залежить від локалі Windows
REM (на відміну від %date%, чий формат/мова різниться між ПК)
for /f %%d in ('powershell -NoProfile -Command "(Get-Date).DayOfWeek.value__"') do set "DOW=%%d"

if not "%DOW%"=="0" (
  echo   [бекапи] Сьогодні не неділя — очищення пропущено.
  goto :eof
)

if not exist "%BACKUP_DIR%\" (
  echo   [бекапи] ! Папка не знайдена: %BACKUP_DIR%
  echo   [бекапи] ! Перевірте BACKUP_DIR у cleanup-backups.bat.
  goto :eof
)

echo   [бекапи] Неділя — очищення %BACKUP_DIR% ^(лишаю останні %KEEP%^)...

set /a COUNT=0
for /f "delims=" %%f in ('dir /b /o-n "%BACKUP_DIR%\herkules-????-??-??-????.json" 2^>nul') do (
  set /a COUNT+=1
  if !COUNT! GTR %KEEP% (
    echo     видаляю %%f
    del /q "%BACKUP_DIR%\%%f" 2>nul
  )
)

if %COUNT%==0 (
  echo   [бекапи] Файлів бекапу не знайдено.
) else (
  echo   [бекапи] Готово, лишилось не більше %KEEP% файлів.
)

endlocal
