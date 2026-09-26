import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import {
  type CallFilters,
  type CallListItem,
  LIVE_CALL_STATUSES,
  type RealtimeCall,
} from '../api/types';
import { useQuery } from './useQuery';
import { useSocketEvent } from './useSocket';

/**
 * Paginated, filtered call log. While on page 1, new activity triggers a (debounced) background
 * refresh so the log stays current without hammering the API during bursts.
 */
export function useCalls(filters: CallFilters) {
  const query = useQuery(() => api.calls.list(filters), [JSON.stringify(filters)]);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useSocketEvent('call:updated', () => {
    if (filters.page !== 1 || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      query.reload();
    }, 2_000);
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  return query;
}

/** Calls currently in progress, seeded from the API then maintained from `call:updated`. */
export function useLiveCalls() {
  const query = useQuery(
    () => api.calls.listByStatuses(LIVE_CALL_STATUSES).then((r) => r.items),
    [],
  );
  const [live, setLive] = useState<Map<string, RealtimeCall>>(new Map());

  useEffect(() => {
    if (!query.data) return;
    setLive(
      new Map(
        query.data.map((c: CallListItem) => [
          c.id,
          {
            id: c.id,
            status: c.status,
            campaignId: c.campaignId,
            leadId: c.leadId,
            agentId: c.agentId,
            phone: c.lead?.phone ?? null,
            answeredAt: c.answeredAt,
            createdAt: c.createdAt,
          },
        ]),
      ),
    );
  }, [query.data]);

  useSocketEvent<RealtimeCall>('call:updated', (call) => {
    setLive((prev) => {
      const next = new Map(prev);
      if (LIVE_CALL_STATUSES.includes(call.status)) {
        next.set(call.id, {
          ...prev.get(call.id),
          ...call,
          phone: call.phone ?? prev.get(call.id)?.phone ?? null,
        });
      } else {
        next.delete(call.id);
      }
      return next;
    });
  });

  const calls = [...live.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { calls, loading: query.loading, error: query.error, reload: query.reload };
}
