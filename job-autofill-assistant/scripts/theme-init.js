// 在页面样式加载前应用主题，避免闪烁；独立文件满足 Manifest V3 CSP。
(function () {
  try {
    const theme = localStorage.getItem('capybara-ui-theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch {}
})();
