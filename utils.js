// Утилиты для работы с временем и датами
function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function formatTime(timeStr) {
  if (!timeStr) return null;
  // Если время в формате "HH:MM:SS", обрезаем до "HH:MM"
  if (timeStr.length > 5) {
    return timeStr.substring(0, 5);
  }
  return timeStr;
}

function formatDate(dateValue) {
  if (!dateValue) return null;
  // Если это Date объект
  if (dateValue instanceof Date) {
    const y = dateValue.getFullYear();
    const m = String(dateValue.getMonth() + 1).padStart(2, '0');
    const d = String(dateValue.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // Если это строка, проверяем формат
  if (typeof dateValue === 'string') {
    // Если формат уже YYYY-MM-DD, возвращаем как есть
    if (/^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
      return dateValue.substring(0, 10);
    }
  }
  return dateValue;
}

function checkTimeOverlap(start1, end1, start2, end2) {
  return start1 < end2 && end1 > start2;
}

// Валидация телефона
function validatePhone(phone) {
  if (!phone) return { valid: false, message: 'Телефон обязателен' };
  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.length < 9) {
    return { valid: false, message: 'Некорректный номер телефона (минимум 9 цифр)' };
  }
  return { valid: true };
}

// Валидация username
function validateUsername(username) {
  if (!username) return { valid: false, message: 'Логин обязателен' };
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 30) {
    return { valid: false, message: 'Логин должен быть от 3 до 30 символов' };
  }
  return { valid: true, username: trimmed };
}

// Валидация password
function validatePassword(password) {
  if (!password) return { valid: false, message: 'Пароль обязателен' };
  if (password.length < 6) {
    return { valid: false, message: 'Пароль должен содержать минимум 6 символов' };
  }
  return { valid: true };
}

// Форматирование booking для ответа API
function formatBooking(booking) {
  return {
    id: booking.id,
    userId: booking.user_id,
    name: booking.name,
    phone: booking.phone,
    service: booking.service,
    master: booking.master,
    date: formatDate(booking.date),
    time: formatTime(booking.time),
    endTime: formatTime(booking.end_time),
    comment: booking.comment,
    createdAt: booking.created_at
  };
}

module.exports = {
  timeToMinutes,
  formatTime,
  formatDate,
  checkTimeOverlap,
  validatePhone,
  validateUsername,
  validatePassword,
  formatBooking
};

