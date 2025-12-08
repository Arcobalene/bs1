@echo off
echo ====================================
echo Beauty Studio - Запуск сервера
echo ====================================
echo.

REM Проверка наличия Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ОШИБКА] Node.js не установлен!
    echo Пожалуйста, установите Node.js с https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js найден
echo.

REM Проверка наличия node_modules
if not exist "node_modules\" (
    echo Установка зависимостей...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ОШИБКА] Не удалось установить зависимости
        pause
        exit /b 1
    )
    echo [OK] Зависимости установлены
    echo.
)

echo Запуск сервера...
echo Сервер будет доступен по адресу: http://localhost:3000
echo.
echo Для остановки нажмите Ctrl+C
echo.

node server.js

pause

