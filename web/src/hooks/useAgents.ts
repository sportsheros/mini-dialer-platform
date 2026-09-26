import { api } from '../api/client';
import type { Agent } from '../api/types';
import { useQuery } from './useQuery';
import { useSocketEvent } from './useSocket';

/** All agents, kept live via `agent:updated` (payloads may be partial, e.g. `{ id, status }`). */
export function useAgents() {
  const query = useQuery(() => api.agents.list().then((r) => r.items), []);

  useSocketEvent<Partial<Agent> & { id: string }>('agent:updated', (update) => {
    query.setData((current) => {
      if (!current) return current;
      const exists = current.some((a) => a.id === update.id);
      if (!exists) {
        // A new agent we haven't seen: refetch to get the full record.
        query.reload();
        return current;
      }
      return current.map((a) => (a.id === update.id ? { ...a, ...update } : a));
    });
  });

  return query;
}
