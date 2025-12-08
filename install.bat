@echo off
echo ====================================
echo Beauty Studio - Установка
echo ====================================
echo.

REM Проверка наличия Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ОШИБКА] Node.js не установлен!
    echo.
    echo Пожалуйста, установите Node.js:
    echo 1. Перейдите на https://nodejs.org/
    echo 2. Скачайте LTS версию
    echo 3. Установите Node.js
    echo 4. Перезапустите этот скрипт
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js найден
node --version
npm --version
echo.

echo Установка зависимостей...
echo Это может занять несколько минут...
echo.

call npm install

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ОШИБКА] Не удалось установить зависимости
    echo Попробуйте запустить от имени администратора
    pause
    exit /b 1
)

echo.
echo ====================================
echo [OK] Установка завершена!
echo ====================================
echo.
echo Теперь вы можете запустить сервер командой:
echo   start.bat
echo.
echo Или вручную:
echo   npm start
echo.
pause

