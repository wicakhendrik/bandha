import { useCallback, useState } from "react";
import { mutate } from "swr";

/** Pull-to-refresh: revalidates every SWR key. */
export function useRefresh() {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await mutate(() => true); } finally { setRefreshing(false); }
  }, []);
  return { refreshing, refresh };
}

/** One idempotency key per form session: a retry after a dropped connection can never post twice. */
export const newIdempotencyKey = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
