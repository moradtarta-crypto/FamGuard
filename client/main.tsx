import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container missing');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Cache only the static app shell. The service worker deliberately excludes API and
// Supabase traffic so private family data is never stored in the offline cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((cause: unknown) => {
      console.warn('FamGuard offline shell could not be enabled.', cause);
    });
  });
}
