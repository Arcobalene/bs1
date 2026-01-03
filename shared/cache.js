// Кэш для пользователей и других данных
const NodeCache = require('node-cache');

// Кэш пользователей с TTL 5 минут
const userCache = new NodeCache({ 
  stdTTL: 300, // 5 минут
  checkperiod: 60, // Проверка каждую минуту
  useClones: false // Для производительности
});

// Кэш для общих данных (салоны, услуги) с TTL 1 минута
const dataCache = new NodeCache({
  stdTTL: 60,
  checkperiod: 30
});

// Функция для получения пользователя из кэша или БД
async function getUserFromCache(userId, dbFunction) {
  const cacheKey = `user:${userId}`;
  const cached = userCache.get(cacheKey);
  
  if (cached) {
    return cached;
  }
  
  const user = await dbFunction(userId);
  if (user) {
    userCache.set(cacheKey, user);
  }
  
  return user;
}

// Функция для инвалидации кэша пользователя
function invalidateUserCache(userId) {
  userCache.del(`user:${userId}`);
  // Также удаляем из общего кэша данных, которые могут зависеть от пользователя
  dataCache.flushAll();
}

// Функция для получения данных с кэшированием
function getCached(key, fetchFunction, ttl = 60) {
  const cached = dataCache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }
  
  return fetchFunction().then(data => {
    dataCache.set(key, data, ttl);
    return data;
  });
}

module.exports = {
  getUserFromCache,
  invalidateUserCache,
  getCached,
  userCache,
  dataCache
};

