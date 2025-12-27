-- Дополнительные индексы для оптимизации производительности БД
-- Выполнить эти запросы после инициализации базы данных

-- Индекс для поиска по мастеру в записях
CREATE INDEX IF NOT EXISTS idx_bookings_master ON bookings(master) 
WHERE master IS NOT NULL AND master != '';

-- Составной индекс для запросов по пользователю и дате
CREATE INDEX IF NOT EXISTS idx_bookings_user_date ON bookings(user_id, date);

-- Индекс для запросов по дате и времени
CREATE INDEX IF NOT EXISTS idx_bookings_date_time ON bookings(date, time);

-- Индекс на created_at для сортировки
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);

-- Индекс для notifications по booking_id
CREATE INDEX IF NOT EXISTS idx_notifications_booking_id ON notifications(booking_id) 
WHERE booking_id IS NOT NULL;

-- Индекс на created_at для users
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- Функция для нормализации телефона (опционально, для улучшения поиска)
CREATE OR REPLACE FUNCTION normalize_phone(phone_text TEXT)
RETURNS TEXT AS $$
BEGIN
  IF phone_text IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone_text, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Индекс для нормализованных телефонов (требует computed column или триггера)
-- Это более сложная оптимизация, которая может быть реализована позже

