// JavaScript для лендинга

document.addEventListener('DOMContentLoaded', function() {
  // Базовая инициализация для лендинга
  console.log('Landing page loaded');

  // Получаем элементы модальных окон
  const loginBtn = document.getElementById('login-btn');
  const registerBtn = document.getElementById('register-btn');
  const loginModal = document.getElementById('loginModal');
  const registerModal = document.getElementById('registerModal');
  const closeButtons = document.querySelectorAll('.modal-close');

  // Открываем модальное окно входа
  if (loginBtn) {
    loginBtn.addEventListener('click', function(e) {
      e.preventDefault();
      if (loginModal) {
        loginModal.style.display = 'flex';
      }
    });
  }

  // Открываем модальное окно регистрации
  if (registerBtn) {
    registerBtn.addEventListener('click', function(e) {
      e.preventDefault();
      if (registerModal) {
        registerModal.style.display = 'flex';
      }
    });
  }

  // Закрываем модальные окна по кнопке
  closeButtons.forEach(button => {
    button.addEventListener('click', function() {
      const modal = this.closest('.modal-overlay');
      if (modal) {
        modal.style.display = 'none';
      }
    });
  });

  // Закрываем модальные окна при клике вне их
  [loginModal, registerModal].forEach(modal => {
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === this) {
          this.style.display = 'none';
        }
      });
    }
  });

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
