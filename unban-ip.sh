#!/bin/bash
# Скрипт для разблокировки IP в fail2ban

echo "=== FAIL2BAN IP UNBAN SCRIPT ==="
echo ""

# Проверяем fail2ban
if ! command -v fail2ban-client &> /dev/null; then
    echo "fail2ban не установлен"
    exit 0
fi

echo "1. Проверяем статус fail2ban:"
systemctl status fail2ban --no-pager | head -5
echo ""

echo "2. Список заблокированных IP в jail sshd:"
fail2ban-client status sshd
echo ""

echo "3. Введите IP для разблокировки (или нажмите Enter для пропуска):"
read -p "IP: " user_ip

if [ -n "$user_ip" ]; then
    echo "Разблокируем IP: $user_ip"
    fail2ban-client set sshd unbanip "$user_ip"
    echo "Готово!"
    echo ""
    echo "Проверяем снова:"
    fail2ban-client status sshd
else
    echo "Пропущено"
fi

echo ""
echo "4. Хотите разблокировать ВСЕ IP? (y/n)"
read -p "Ответ: " answer

if [ "$answer" = "y" ]; then
    echo "Останавливаем fail2ban..."
    systemctl stop fail2ban
    echo "Очищаем все правила iptables для fail2ban..."
    iptables -L f2b-sshd -n --line-numbers 2>/dev/null | grep -v "^Chain" | grep -v "^num" | tac | while read line; do
        num=$(echo $line | awk '{print $1}')
        if [[ "$num" =~ ^[0-9]+$ ]]; then
            iptables -D f2b-sshd $num
        fi
    done
    echo "Запускаем fail2ban обратно..."
    systemctl start fail2ban
    echo "Готово! Все IP разблокированы"
fi

echo ""
echo "=== ГОТОВО ==="
