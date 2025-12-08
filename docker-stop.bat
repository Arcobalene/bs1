@echo off
echo ====================================
echo Beauty Studio - Остановка Docker
echo ====================================
echo.

REM Проверка наличия Docker
where docker >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ОШИБКА] Docker не установлен!
    pause
    exit /b 1
)

echo Остановка контейнера...
docker-compose down

if %ERRORLEVEL% NEQ 0 (
    echo [ОШИБКА] Не удалось остановить контейнер
    pause
    exit /b 1
)

echo.
echo [OK] Контейнер остановлен
echo.
pause

