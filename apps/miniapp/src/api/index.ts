/**
 * apiFactory (§19.2): LocalApi in the demo build, HttpApi otherwise. The condition is a build-time constant,
 * so the unused transport (and PGlite) is tree-shaken out of the other build.
 */
import { getInitData } from '../telegram/webapp';
import type { ApiClient } from './types';

export const IS_DEMO = import.meta.env.VITE_TARGET === 'demo';

export async function createApiClient(): Promise<ApiClient> {
  if (IS_DEMO) {
    const { createLocalApi } = await import('./local/client');
    return createLocalApi();
  }
  const { createHttpApi } = await import('./http');
  return createHttpApi(import.meta.env.VITE_API_URL ?? '', getInitData);
}

export * from './types';
export { ApiProvider, useApi, useBackendStatus, useQuery, useMutation, invalidate } from './provider';
