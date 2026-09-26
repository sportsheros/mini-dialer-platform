import { useState } from 'react';
import { api } from '../api/client';
import { CALL_STATUSES, type CallFilters, type CallListItem, type CallStatus } from '../api/types';
import { DataTable } from '../components/DataTable';
import { Drawer } from '../components/Drawer';
import { Pagination } from '../components/Pagination';
import { ErrorState, Loading } from '../components/QueryStates';
import { StatusBadge } from '../components/StatusBadge';
import { useAgents } from '../hooks/useAgents';
import { useCalls } from '../hooks/useCalls';
import { useCampaigns } from '../hooks/useCampaigns';
import { useQuery } from '../hooks/useQuery';
import { formatDateTime, formatDuration, formatTime } from '../lib/format';

const INITIAL: CallFilters = {
  page: 1,
  limit: 20,
  status: '',
  agentId: '',
  campaignId: '',
  from: '',
  to: '',
};

function CallDetailView({ callId }: { callId: string }) {
  const { data: call, loading, error, reload } = useQuery(() => api.calls.get(callId), [callId]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !call) return <Loading />;

  return (
    <div className="detail">
      <dl className="detail-grid">
        <dt>Status</dt>
        <dd>
          <StatusBadge status={call.status} />
        </dd>
        <dt>Phone</dt>
        <dd className="mono">{call.lead?.phone}</dd>
        <dt>Lead</dt>
        <dd>{call.lead?.name ?? '—'}</dd>
        <dt>Agent</dt>
        <dd>{call.agent?.name ?? '—'}</dd>
        <dt>Campaign</dt>
        <dd>{call.campaign?.name ?? '—'}</dd>
        <dt>Started</dt>
        <dd>{formatDateTime(call.createdAt)}</dd>
        <dt>Answered</dt>
        <dd>{formatDateTime(call.answeredAt)}</dd>
        <dt>Ended</dt>
        <dd>{formatDateTime(call.endedAt)}</dd>
        <dt>Duration</dt>
        <dd>{formatDuration(call.durationSec)}</dd>
      </dl>

      <h3>QA audit</h3>
      {call.summary ? (
        <div className="qa">
          <div className={`qa-score ${call.qaScore !== null && call.qaScore < 60 ? 'qa-low' : ''}`}>
            {call.qaScore}
            <span>/100</span>
          </div>
          <div>
            <p>{call.summary}</p>
            {call.qaFlags && call.qaFlags.length > 0 && (
              <div className="flags">
                {call.qaFlags.map((f) => (
                  <span key={f} className="badge badge-red">
                    {f.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="muted">
          {call.answeredAt
            ? 'Summary pending (processed asynchronously).'
            : 'Not connected — no summary.'}
        </p>
      )}

      <h3>Timeline</h3>
      {call.events.length === 0 ? (
        <p className="muted">No events.</p>
      ) : (
        <ol className="timeline">
          {call.events.map((e) => (
            <li key={e.id} className={e.applied ? '' : 'timeline-ignored'}>
              <span className="mono small">{formatTime(e.occurredAt)}</span>
              <StatusBadge status={e.type} />
              {!e.applied && <span className="muted small">ignored: {e.note}</span>}
              {e.providerEventId.startsWith('internal:') && (
                <span className="muted small">(system)</span>
              )}
            </li>
          ))}
        </ol>
      )}

      {call.transcript && (
        <>
          <h3>Transcript</h3>
          <pre className="transcript">{call.transcript}</pre>
        </>
      )}
    </div>
  );
}

export function CallLogs() {
  const [filters, setFilters] = useState<CallFilters>(INITIAL);
  const [selected, setSelected] = useState<string>();
  const calls = useCalls(filters);
  const agents = useAgents();
  const campaigns = useCampaigns();

  const update = (patch: Partial<CallFilters>) => setFilters((f) => ({ ...f, ...patch, page: 1 }));

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Call logs</h2>
        <button className="btn btn-small" onClick={() => setFilters(INITIAL)}>
          Reset filters
        </button>
      </header>

      <div className="filters">
        <label>
          Status
          <select
            value={filters.status}
            onChange={(e) => update({ status: e.target.value as CallStatus | '' })}
          >
            <option value="">All</option>
            {CALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agent
          <select value={filters.agentId} onChange={(e) => update({ agentId: e.target.value })}>
            <option value="">All</option>
            {agents.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Campaign
          <select
            value={filters.campaignId}
            onChange={(e) => update({ campaignId: e.target.value })}
          >
            <option value="">All</option>
            {campaigns.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="datetime-local"
            value={filters.from}
            onChange={(e) => update({ from: e.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="datetime-local"
            value={filters.to}
            onChange={(e) => update({ to: e.target.value })}
          />
        </label>
      </div>

      <DataTable<CallListItem>
        rows={calls.data?.items}
        loading={calls.loading}
        error={calls.error}
        onRetry={calls.reload}
        rowKey={(c) => c.id}
        onRowClick={(c) => setSelected(c.id)}
        emptyMessage="No calls match these filters."
        columns={[
          { header: 'Started', render: (c) => formatDateTime(c.createdAt) },
          { header: 'Phone', render: (c) => <span className="mono">{c.lead?.phone ?? '—'}</span> },
          { header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
          { header: 'Agent', render: (c) => c.agent?.name ?? '—' },
          { header: 'Duration', align: 'right', render: (c) => formatDuration(c.durationSec) },
          { header: 'QA', align: 'right', render: (c) => c.qaScore ?? '—' },
        ]}
      />
      <Pagination
        meta={calls.data?.meta}
        onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
      />

      <Drawer open={!!selected} title="Call detail" onClose={() => setSelected(undefined)}>
        {selected && <CallDetailView callId={selected} />}
      </Drawer>
    </section>
  );
}
