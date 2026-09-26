import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Campaign, CampaignStats } from '../api/types';
import { useQuery } from './useQuery';
import { useSocketEvent } from './useSocket';

export function useCampaigns() {
  const query = useQuery(() => api.campaigns.list().then((r) => r.items), []);

  useSocketEvent<Partial<Campaign> & { id: string }>('campaign:updated', (update) => {
    query.setData((current) => {
      if (!current) return current;
      if (!current.some((c) => c.id === update.id)) {
        query.reload();
        return current;
      }
      return current.map((c) => (c.id === update.id ? { ...c, ...update } : c));
    });
  });

  return query;
}

/**
 * Stats for the given campaigns, polled every `intervalMs`. The backend serves them cache-aside
 * (TTL 30s, invalidated on call end), so polling is cheap.
 */
export function useCampaignStats(campaignIds: string[], intervalMs = 5_000) {
  const [stats, setStats] = useState<Record<string, CampaignStats>>({});
  const [error, setError] = useState<Error>();
  const key = campaignIds.join(',');
  const idsRef = useRef(campaignIds);
  idsRef.current = campaignIds;
  const loadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const results = await Promise.all(idsRef.current.map((id) => api.campaigns.stats(id)));
        if (cancelled) return;
        setStats(Object.fromEntries(results.map((s) => [s.campaignId, s])));
        setError(undefined);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      }
    };
    loadRef.current = load;
    void load();
    const timer = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, intervalMs]);

  /** Re-fetch now, e.g. right after an upload or start/pause, instead of waiting for the poll. */
  const refresh = useCallback(() => void loadRef.current(), []);

  return { stats, error, refresh };
}
