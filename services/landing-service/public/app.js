// Минимальный JavaScript для лендинга
// В основном используется для базовой функциональности

document.addEventListener('DOMContentLoaded', function() {
  // Базовая инициализация для лендинга
  console.log('Landing page loaded');

  // Обработка кликов на ссылки для перенаправления на gateway
  const links = document.querySelectorAll('a[href^="/"]');
  links.forEach(link => {
    link.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      // Если ссылка ведет на маршруты gateway, перенаправляем на корень
      const gatewayRoutes = ['/register', '/login', '/register/master', '/login-client', '/booking', '/admin', '/master', '/client-cabinet'];
      if (gatewayRoutes.some(route => href === route || href.startsWith(route + '?') || href.startsWith(route + '#'))) {
        e.preventDefault();
        // Получаем базовый URL (удаляем /landing из пути)
        const baseUrl = window.location.origin;
        window.location.href = baseUrl + href;
      }
    });
  });
});
