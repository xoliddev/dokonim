/** Theme editor draft autosave: a change made mid-save is saved too, and leaving inside the debounce still saves. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_TOKENS } from '@dokonim/core';
import { ApiProvider, makeApi, type ApiClient } from '../src/api';
import { setLocale } from '../src/i18n';
import { navigate } from '../src/router/router';
import ThemeEditor from '../src/seller/screens/settings/ThemeEditor';

afterEach(cleanup);
beforeAll(() => {
  setLocale('en');
  (Element.prototype as unknown as { animate: () => unknown }).animate ??= () => ({ finished: Promise.resolve(), cancel() {} });
  navigate('/m/atlas/settings/theme');
});

function setup() {
  const saves: Array<{ tokens: { brand: string }; release: () => void }> = [];
  const client = {
    kind: 'local', ready: Promise.resolve(), status: () => ({ phase: 'ready', progress: 1, persistent: true }), subscribe: () => () => {}, onEvent: () => () => {},
    api: makeApi(async (name, input) => {
      if (name === 'store.get') return { store: { id: 'S1', slug: 'atlas', name: { uz: 'Atlas' }, defaultLocale: 'uz', currency: 'UZS' }, role: 'owner', theme: { tokens: DEFAULT_TOKENS } };
      if (name === 'admin.theme.get') return { draft: null, published: { tokens: DEFAULT_TOKENS, sections: [], version: 1 }, versions: [], presets: [] };
      if (name === 'admin.theme.saveDraft') return new Promise((r) => saves.push({ tokens: (input as { tokens: { brand: string } }).tokens, release: () => r({ ok: true }) }));
      return {};
    }),
  } as unknown as ApiClient;
  const ui = render(<ApiProvider client={client}><ThemeEditor params={{ slug: 'atlas' }} query={new URLSearchParams()} /></ApiProvider>);
  return { saves, ui };
}

describe('ThemeEditor autosave', () => {
  it('saves a change made while the previous save was in flight', async () => {
    const { saves } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '#c0392b' }));
    await waitFor(() => expect(saves).toHaveLength(1), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: '#1f6e5a' }));
    await act(async () => saves[0]!.release());
    await waitFor(() => expect(saves).toHaveLength(2), { timeout: 2000 });
    expect(saves[1]!.tokens.brand).toBe('#1f6e5a');
  });

  it('flushes a pending change on leaving the screen', async () => {
    const { saves, ui } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '#c0392b' }));
    ui.unmount();
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]!.tokens.brand).toBe('#c0392b');
  });
});
