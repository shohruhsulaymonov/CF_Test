// Настройки сайта. Меняйте здесь, остальной код трогать не нужно.
window.APP_CONFIG = {
  appTitle: 'Тренажёр экзаменационных вопросов',
  // Короткое название для логотипа в боковом меню.
  brand: 'Тренажёр',

  // Набор, который открывается на главной. Остальные наборы из sets/manifest.js
  // попадают в раздел «Другие наборы».
  primarySetId: 'corpfin',

  // Администраторы с Firebase: Google-аккаунты (e-mail), которым открыта админ-панель.
  // Тот же список нужно вписать в firestore.rules.
  adminEmails: ['shsulaymonov2007@gmail.com'],
  // Без Firebase вход по имени; это имя открывает админ-панель. Держите его в секрете (ТЗ §5).
  adminNames: ['Админ'],

  // Общее хранилище и вход через Google (см. README, «Firebase»).
  // null — вход по имени, всё хранится только в браузере. Значения берутся из
  // Firebase → Project settings → Your apps → Web app → SDK setup and configuration → Config.
  firebase: {
    apiKey: 'AIzaSyCGRDJAXd5zA4XEkWAO0PVmihDPdNLx3xA',
    authDomain: 'corp-finances.firebaseapp.com',
    projectId: 'corp-finances',
    storageBucket: 'corp-finances.firebasestorage.app',
    messagingSenderId: '41210522387',
    appId: '1:41210522387:web:00a6206333bd738334c8e6'
  },
  // firebase: {
  //   apiKey: '…',
  //   authDomain: '<project>.firebaseapp.com',
  //   projectId: '<project>',
  //   appId: '…'
  // },

  // Часовой пояс для дат и аналитики (ТЗ §10).
  timeZone: 'Asia/Tashkent',

  modes: {
    cards: { deck: 20 },
    board: { tiles: 16 },
    jeopardy: { maxCategories: 5, minPerCategory: 3 },
    quiz: { count: 10, counts: [10, 20, 50], timerSec: 20 }
  }
};
