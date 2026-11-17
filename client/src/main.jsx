import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

document.documentElement.dataset.theme = 'dark-modern';
document.documentElement.style.colorScheme = 'dark';

// Scrolling the page must never bump a focused <input type="number"> up/down.
document.addEventListener('wheel', () => {
  const el = document.activeElement;
  if (el?.tagName === 'INPUT' && el.type === 'number') el.blur();
}, { passive: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
