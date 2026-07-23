import React from 'react';
import ReactDOM from 'react-dom/client';

const isMobileRuntime = import.meta.env.VITE_APP_TARGET === 'mobile';
document.documentElement.classList.toggle('mobile-runtime', isMobileRuntime);
if (isMobileRuntime) {
  document.title = 'FTranslate 移动阅读';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f7f9fc');
}

async function loadRuntimeApp() {
  if (isMobileRuntime) {
    await import('katex/dist/katex.min.css');
    return import('./mobile/MobileApp');
  }
  await Promise.all([import('katex/dist/katex.min.css'), import('./styles/global.css')]);
  return import('./App');
}

void loadRuntimeApp().then(({ default: App }) => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
