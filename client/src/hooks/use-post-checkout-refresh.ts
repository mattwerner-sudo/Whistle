import { useEffect, useRef } from 'react';
import { queryClient } from '@/lib/queryClient';

/**
 * After returning from Stripe checkout the account update lands asynchronously
 * via webhook, so the new plan/credits may not be visible on the first fetch.
 * When `active` is true (the `?success=true` return), this invalidates the given
 * account queries immediately and then re-invalidates a few times over a short
 * window so a slightly delayed webhook still surfaces the new state without a
 * manual page reload. It runs once per mount and then stops.
 */
export function usePostCheckoutRefresh(active: boolean, queryKeys: string[]) {
  const startedRef = useRef(false);
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;

    const invalidate = () => {
      for (const key of keysRef.current) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    };

    invalidate();

    let attempts = 0;
    const MAX_ATTEMPTS = 5;
    const INTERVAL_MS = 1500;
    const id = setInterval(() => {
      attempts += 1;
      invalidate();
      if (attempts >= MAX_ATTEMPTS) clearInterval(id);
    }, INTERVAL_MS);

    return () => clearInterval(id);
  }, [active]);
}
