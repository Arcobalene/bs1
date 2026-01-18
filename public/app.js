// Общие функции для работы со временем

function timeToMinutes(t) {
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToTime(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getEndTime(startTime, durationMinutes) {
  const start = timeToMinutes(startTime);
  if (start === null) return "";
  const end = start + durationMinutes;
  return minutesToTime(end);
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Модальные окна для landing страницы
document.addEventListener('DOMContentLoaded', function() {
  // Получаем элементы
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

  // Закрываем модальные окна
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
});

