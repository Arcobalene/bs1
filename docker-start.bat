@echo off
echo ====================================
echo Beauty Studio - Docker запуск
echo ====================================
echo.

REM Проверка наличия Docker
where docker >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ОШИБКА] Docker не установлен!
    echo.
    echo Пожалуйста, установите Docker Desktop:
    echo 1. Перейдите на https://www.docker.com/products/docker-desktop
    echo 2. Скачайте Docker Desktop для Windows
    echo 3. Установите и перезапустите компьютер
    echo 4. Убедитесь, что Docker Desktop запущен
    echo.
    pause
    exit /b 1
)

echo [OK] Docker найден
docker --version
echo.

echo Сборка и запуск контейнера...
echo Это может занять несколько минут при первом запуске...
echo.

docker-compose up -d --build

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ОШИБКА] Не удалось запустить контейнер
    echo Убедитесь, что Docker Desktop запущен
    pause
    exit /b 1
)

echo.
echo ====================================
echo [OK] Контейнер запущен!
echo ====================================
echo.
echo Сервер доступен по адресу: http://localhost:3000
echo.
echo Полезные команды:
echo   docker-compose logs -f    - просмотр логов
echo   docker-compose stop       - остановка
echo   docker-compose restart    - перезапуск
echo   docker-compose down       - остановка и удаление
echo.
pause

