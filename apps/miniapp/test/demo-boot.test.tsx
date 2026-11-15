/** Demo boot screen: another tab owning the database, and the reset escape hatch on a boot error. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiProvider, makeApi, type ApiClient, type BackendStatus } from '../src/api';
import { setLocale } from '../src/i18n';
import { BootScreen } from '../src/shell/BootScreen';

afterEach(cleanup);
beforeAll(() => setLocale('en'));

const client = (status: BackendStatus, resetDemo?: () => Promise<void>) =>
  ({ kind: 'local', api: makeApi(async () => ({})), ready: new Promise(() => {}), status: () => status, subscribe: () => () => {}, onEvent: () => () => {}, resetDemo }) as unknown as ApiClient;

describe('BootScreen', () => {
  it('says the demo is open in another tab while waiting for the database', () => {
    render(<ApiProvider client={client({ phase: 'waiting', progress: 0, persistent: true })}><BootScreen /></ApiProvider>);
    expect(screen.getByText(/open in another tab/i)).toBeTruthy();
  });

  it('offers Reset demo when the persisted database fails to open', async () => {
    const resetDemo = vi.fn(async () => {});
    const reload = vi.fn();
    vi.stubGlobal('location', { ...location, reload });
    render(<ApiProvider client={client({ phase: 'error', progress: 0, persistent: true, error: 'migration 0042 failed' }, resetDemo)}><BootScreen /></ApiProvider>);
    expect(screen.getByText('migration 0042 failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo' }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(resetDemo).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
