import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Campaign, UploadResult } from '../api/types';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { useCampaigns, useCampaignStats } from '../hooks/useCampaigns';
import { formatDateTime, formatPercent } from '../lib/format';
import { parseLeads } from '../lib/parseLeads';

const errorMessage = (err: unknown) =>
  err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong';

function CreateCampaignForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [maxCps, setMaxCps] = useState(2);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.campaigns.create({ name, maxCps, maxAttempts });
      setName('');
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel form" onSubmit={(e) => void submit(e)}>
      <h2>New campaign</h2>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
      </label>
      <div className="form-row">
        <label>
          Max CPS
          <input
            type="number"
            min={1}
            max={100}
            value={maxCps}
            onChange={(e) => setMaxCps(Number(e.target.value))}
          />
        </label>
        <label>
          Max attempts
          <input
            type="number"
            min={1}
            max={10}
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(Number(e.target.value))}
          />
        </label>
      </div>
      {error && <div className="alert">{error}</div>}
      <button className="btn btn-primary" disabled={busy || !name.trim()}>
        {busy ? 'Creating…' : 'Create campaign'}
      </button>
    </form>
  );
}

function UploadLeadsForm({ campaigns }: { campaigns: Campaign[] }) {
  const [campaignId, setCampaignId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<UploadResult>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setResult(undefined);
    let leads;
    try {
      leads = parseLeads(text);
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    setBusy(true);
    try {
      setResult(await api.campaigns.uploadLeads(campaignId, leads));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel form" onSubmit={(e) => void submit(e)}>
      <h2>Upload leads</h2>
      <label>
        Campaign
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} required>
          <option value="">Select…</option>
          {campaigns
            .filter((c) => c.status !== 'completed')
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Paste CSV (<code>phone,name</code>) or JSON (
        <code>
          [{'{'}"phone","name"{'}'}]
        </code>
        ), max 5,000
        <textarea
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'phone,name\n+14155550100,Ann Lee\n+14155550101,Bob Stone'}
          className="mono"
        />
      </label>
      {error && <div className="alert">{error}</div>}
      {result && (
        <div className="upload-result">
          <span className="badge badge-green">{result.inserted} inserted</span>
          <span className="badge badge-gray">{result.duplicates} duplicates</span>
          <span className="badge badge-purple">{result.dnc} DNC</span>
          <span className="badge badge-red">{result.invalid} invalid</span>
        </div>
      )}
      <button className="btn btn-primary" disabled={busy || !campaignId}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  );
}

export function Campaigns() {
  const campaigns = useCampaigns();
  const { stats } = useCampaignStats(
    (campaigns.data ?? []).map((c) => c.id),
    10_000,
  );
  const [actionError, setActionError] = useState<string>();
  const [pending, setPending] = useState<string>();

  const act = async (c: Campaign, action: 'start' | 'pause') => {
    setPending(c.id);
    setActionError(undefined);
    try {
      await api.campaigns[action](c.id);
      campaigns.reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPending(undefined);
    }
  };

  return (
    <div className="campaigns">
      <section className="panel">
        <header className="panel-header">
          <h2>Campaigns</h2>
        </header>
        {actionError && <div className="alert">{actionError}</div>}
        <DataTable<Campaign>
          rows={campaigns.data}
          loading={campaigns.loading}
          error={campaigns.error}
          onRetry={campaigns.reload}
          rowKey={(c) => c.id}
          emptyMessage="No campaigns yet — create one on the right."
          columns={[
            { header: 'Name', render: (c) => c.name },
            { header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
            {
              header: 'Leads',
              align: 'right',
              render: (c) => {
                const s = stats[c.id];
                return s
                  ? `${s.totalLeads - s.leadsByStatus.pending - s.leadsByStatus.dialing}/${s.totalLeads}`
                  : '…';
              },
            },
            {
              header: 'Answer rate',
              align: 'right',
              render: (c) => (stats[c.id] ? formatPercent(stats[c.id].answerRate) : '…'),
            },
            { header: 'CPS', align: 'right', render: (c) => c.maxCps },
            { header: 'Attempts', align: 'right', render: (c) => c.maxAttempts },
            { header: 'Created', render: (c) => formatDateTime(c.createdAt) },
            {
              header: 'Actions',
              render: (c) =>
                c.status === 'running' ? (
                  <button
                    className="btn btn-small"
                    disabled={pending === c.id}
                    onClick={() => void act(c, 'pause')}
                  >
                    Pause
                  </button>
                ) : c.status === 'completed' ? null : (
                  <button
                    className="btn btn-small btn-primary"
                    disabled={pending === c.id}
                    onClick={() => void act(c, 'start')}
                  >
                    {c.status === 'paused' ? 'Resume' : 'Start'}
                  </button>
                ),
            },
          ]}
        />
      </section>
      <div className="campaigns-side">
        <CreateCampaignForm onCreated={campaigns.reload} />
        <UploadLeadsForm campaigns={campaigns.data ?? []} />
      </div>
    </div>
  );
}
