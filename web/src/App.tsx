import { useEffect, useState } from 'react';
import { API_KEY } from './api/client';
import { useSocket } from './hooks/useSocket';
import { CallLogs } from './pages/CallLogs';
import { Campaigns } from './pages/Campaigns';
import { LiveDashboard } from './pages/LiveDashboard';

const ROUTES = {
  '#/': { label: 'Live dashboard', component: LiveDashboard },
  '#/calls': { label: 'Call logs', component: CallLogs },
  '#/campaigns': { label: 'Campaigns', component: Campaigns },
} as const;
type Route = keyof typeof ROUTES;

// Hash routing: three pages don't justify a router dependency, and it works on any static host.
function useHashRoute(): Route {
  const read = (): Route =>
    window.location.hash in ROUTES ? (window.location.hash as Route) : '#/';
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function App() {
  const route = useHashRoute();
  const { connected } = useSocket();
  const Page = ROUTES[route].component;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">☎ Mini Dialer</div>
        <nav>
          {(Object.keys(ROUTES) as Route[]).map((r) => (
            <a key={r} href={r} className={r === route ? 'active' : undefined}>
              {ROUTES[r].label}
            </a>
          ))}
        </nav>
        <div className={`live-indicator ${connected ? 'on' : 'off'}`} title="Socket.IO connection">
          <span className="dot" /> {connected ? 'Live' : 'Offline'}
        </div>
      </header>
      {!API_KEY && (
        <div className="alert banner">
          VITE_API_KEY is not set. Copy <code>web/.env.example</code> to <code>web/.env</code> and
          set it to the backend&apos;s API_KEY.
        </div>
      )}
      <main className="content">
        <Page />
      </main>
    </div>
  );
}
