/** Staff invite links: `startapp=i-<token>` opens the accept screen, which joins the team and opens the dashboard. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiProvider, makeApi, type ApiClient } from '../src/api';
import { setLocale } from '../src/i18n';
import { matchRoute, routerStore, startRoute } from '../src/router/router';
import { routes } from '../src/app/routes';
import Invite from '../src/shell/Invite';

afterEach(cleanup);
beforeAll(() => setLocale('en'));

describe('staff invite', () => {
  it('routes the invite start param to the accept screen', () => {
    history.replaceState(null, '', '/?startapp=i-tok_12345678');
    expect(startRoute()).toBe('/invite/tok_12345678');
    expect(matchRoute(routes, '/invite/tok_12345678')?.route.path).toBe('/invite/:token');
    history.replaceState(null, '', '/');
  });

  it('accepts the invite and opens the store dashboard', async () => {
    const calls: [string, unknown][] = [];
    const client = {
      kind: 'http', ready: Promise.resolve(), status: () => ({ phase: 'ready', progress: 1, persistent: true }), subscribe: () => () => {}, onEvent: () => () => {},
      api: makeApi(async (name, input) => (calls.push([name, input]), { storeId: 's1', slug: 'atlas', role: 'manager' })),
    } as unknown as ApiClient;
    render(<ApiProvider client={client}><Invite params={{ token: 'tok_12345678' }} query={new URLSearchParams()} /></ApiProvider>);
    expect(calls).toEqual([]); // nothing happens before the user confirms
    fireEvent.click(screen.getByRole('button', { name: 'Accept invite' }));
    await waitFor(() => expect(routerStore.get().path).toBe('/m/atlas'));
    expect(calls).toEqual([['invites.accept', { token: 'tok_12345678' }]]);
  });
});
