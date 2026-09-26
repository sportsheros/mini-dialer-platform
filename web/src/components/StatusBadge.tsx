const TONES: Record<string, string> = {
  // agents
  available: 'green',
  busy: 'amber',
  offline: 'gray',
  // campaigns
  draft: 'gray',
  running: 'green',
  paused: 'amber',
  // calls / leads
  initiated: 'blue',
  ringing: 'blue',
  dialing: 'blue',
  answered: 'green',
  completed: 'teal',
  pending: 'gray',
  no_answer: 'amber',
  abandoned: 'red',
  failed: 'red',
  dnc: 'purple',
};

export function StatusBadge({ status }: { status: string }) {
  const tone = TONES[status] ?? 'gray';
  return <span className={`badge badge-${tone}`}>{status.replace('_', ' ')}</span>;
}
