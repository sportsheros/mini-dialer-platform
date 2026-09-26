import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Agent, Campaign, RealtimeCall } from '../api/types';
import { DataTable } from '../components/DataTable';
import { Empty, ErrorState, Loading } from '../components/QueryStates';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { useAgents } from '../hooks/useAgents';
import { useLiveCalls } from '../hooks/useCalls';
import { useCampaigns, useCampaignStats } from '../hooks/useCampaigns';
import { formatDuration, formatPercent, secondsSince } from '../lib/format';

function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function AgentsPanel() {
  const { data: agents, loading, error, reload } = useAgents();
  const [pending, setPending] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  const toggle = async (agent: Agent) => {
    setPending(agent.id);
    setActionError(undefined);
    try {
      await api.agents.setStatus(agent.id, agent.status === 'offline' ? 'available' : 'offline');
      // The socket `agent:updated` event updates the list; no manual refetch needed.
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update agent');
    } finally {
      setPending(undefined);
    }
  };

  const counts = useMemo(() => {
    const c = { available: 0, busy: 0, offline: 0 };
    for (const a of agents ?? []) c[a.status]++;
    return c;
  }, [agents]);

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Agents</h2>
        <span className="muted">
          {counts.available} available · {counts.busy} busy · {counts.offline} offline
        </span>
      </header>
      {actionError && <div className="alert">{actionError}</div>}
      {error && !agents ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !agents ? (
        <Loading />
      ) : !agents?.length ? (
        <Empty>No agents yet. Create some via the API or run the simulator.</Empty>
      ) : (
        <ul className="agent-list">
          {agents.map((a) => (
            <li key={a.id} className="agent-row">
              <div>
                <div className="agent-name">{a.name}</div>
                <div className="muted small">{a.email}</div>
              </div>
              <StatusBadge status={a.status} />
              <button
                className="btn btn-small"
                disabled={a.status === 'busy' || pending === a.id}
                title={a.status === 'busy' ? 'Agent is on a call' : undefined}
                onClick={() => void toggle(a)}
              >
                {a.status === 'offline' ? 'Go available' : 'Go offline'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LiveCallsPanel({ agents, campaigns }: { agents: Agent[]; campaigns: Campaign[] }) {
  const { calls, loading, error, reload } = useLiveCalls();
  const now = useNow();
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? '—';
  const campaignName = (id: string) => campaigns.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Live calls</h2>
        <span className="muted">{calls.length} in progress</span>
      </header>
      <DataTable<RealtimeCall>
        rows={loading && calls.length === 0 ? undefined : calls}
        loading={loading}
        error={error}
        onRetry={reload}
        rowKey={(c) => c.id}
        emptyMessage="No calls in progress. Start a campaign to begin dialing."
        columns={[
          { header: 'Phone', render: (c) => <span className="mono">{c.phone ?? '—'}</span> },
          { header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
          { header: 'Agent', render: (c) => agentName(c.agentId) },
          { header: 'Campaign', render: (c) => campaignName(c.campaignId) },
          {
            header: 'Time',
            align: 'right',
            render: (c) => formatDuration(secondsSince(c.answeredAt ?? c.createdAt, now)),
          },
        ]}
      />
    </section>
  );
}

function CampaignCards({ campaigns }: { campaigns: Campaign[] }) {
  const active = campaigns
    .filter((c) => c.status === 'running' || c.status === 'paused')
    .slice(0, 4);
  const { stats, error } = useCampaignStats(active.map((c) => c.id));

  if (active.length === 0) {
    return <Empty>No running or paused campaigns.</Empty>;
  }
  return (
    <>
      {error && <ErrorState error={error} />}
      {active.map((c) => {
        const s = stats[c.id];
        return (
          <section key={c.id} className="panel">
            <header className="panel-header">
              <h2>{c.name}</h2>
              <StatusBadge status={c.status} />
            </header>
            {!s ? (
              <Loading label="Loading stats…" />
            ) : (
              <div className="stat-grid">
                <StatCard
                  label="Leads done"
                  value={`${s.totalLeads - s.leadsByStatus.pending - s.leadsByStatus.dialing} / ${s.totalLeads}`}
                  hint={`${s.leadsByStatus.pending} pending · ${s.leadsByStatus.dnc} DNC`}
                />
                <StatCard label="Calls" value={s.totalCalls} hint={`${s.callsInProgress} live`} />
                <StatCard
                  label="Answer rate"
                  value={formatPercent(s.answerRate)}
                  hint={`${s.callsAnswered} answered`}
                />
                <StatCard label="Avg duration" value={formatDuration(s.avgDurationSec)} />
                <StatCard label="Avg QA score" value={s.avgQaScore ?? '—'} />
                <StatCard
                  label="Abandoned"
                  value={s.callsByStatus.abandoned}
                  hint="answered, no agent free"
                />
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

export function LiveDashboard() {
  const agents = useAgents();
  const campaigns = useCampaigns();

  return (
    <div className="dashboard">
      <div className="dashboard-main">
        {campaigns.error && !campaigns.data ? (
          <ErrorState error={campaigns.error} onRetry={campaigns.reload} />
        ) : !campaigns.data ? (
          <Loading />
        ) : (
          <CampaignCards campaigns={campaigns.data} />
        )}
        <LiveCallsPanel agents={agents.data ?? []} campaigns={campaigns.data ?? []} />
      </div>
      <div className="dashboard-side">
        <AgentsPanel />
      </div>
    </div>
  );
}
