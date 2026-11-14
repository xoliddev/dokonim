/** Root component: API client → providers → frame → shell. */
import { useEffect, useState } from 'react';
import { createApiClient, IS_DEMO, type ApiClient } from '../api';
import { ApiProvider } from '../api/provider';
import { useI18n } from '../i18n';
import { MotionRoot } from '../motion';
import { runFpsProbe } from '../motion/tier';
import { AppShell } from '../shell/AppShell';
import { DemoFrame, StaticDemoLabel } from '../shell/DemoFrame';
import { tg } from '../telegram/shim';
import { routes } from './routes';

export function App() {
  const [client, setClient] = useState<ApiClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    tg.ready();
    createApiClient().then(setClient, (e: unknown) => setError(String(e)));
    runFpsProbe();
  }, []);

  if (!client)
    return (
      <div className="pre-boot" role="status">
        {IS_DEMO && <StaticDemoLabel />}
        <span className="display">{error ? t('common.errorGeneric') : t('common.appName')}</span>
      </div>
    );

  const shell = <AppShell routes={routes} />;
  return (
    <ApiProvider client={client}>
      <MotionRoot>{IS_DEMO ? <DemoFrame>{shell}</DemoFrame> : <div className="frame-full">{shell}</div>}</MotionRoot>
    </ApiProvider>
  );
}
