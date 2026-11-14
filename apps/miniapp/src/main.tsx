import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/onest';
import '@fontsource-variable/unbounded';
import './theme/tokens.css';
import './ui/ui.css';
import './ui/overlay.css';
import './shell/shell.css';
import { launchedFromTelegram, loadTelegramScript } from './telegram/webapp';

async function start() {
  // The demo build skips telegram-web-app.js unless it was actually opened from Telegram (launch params in the hash).
  if (launchedFromTelegram()) await loadTelegramScript();
  // The router reads the launch hash on import, so load the app only after Telegram's script has parsed it.
  const { App } = await import('./app/App');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
