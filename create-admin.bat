@echo off
echo ====================================
echo Создание демо-аккаунта
echo ====================================
echo.

REM Проверка наличия Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ОШИБКА] Node.js не установлен!
    pause
    exit /b 1
)

echo Создание администратора...
node create-admin.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ОШИБКА] Не удалось создать аккаунт
    pause
    exit /b 1
)

echo.
echo Готово! Теперь вы можете войти с логином: admin, пароль: admin123
echo.
pause

