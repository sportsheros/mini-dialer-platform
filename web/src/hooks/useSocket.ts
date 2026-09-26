import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_BASE, API_KEY } from '../api/client';

export type RealtimeEvent = 'agent:updated' | 'call:updated' | 'campaign:updated';

// One shared connection for the whole app, created on first use.
let socket: Socket | undefined;
function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE || undefined, {
      auth: { apiKey: API_KEY },
      transports: ['websocket'],
    });
  }
  return socket;
}

/** Connection status of the shared Socket.IO client. */
export function useSocket(): { connected: boolean } {
  const [connected, setConnected] = useState(() => getSocket().connected);
  useEffect(() => {
    const s = getSocket();
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    s.on('connect', on);
    s.on('disconnect', off);
    s.on('connect_error', off);
    return () => {
      s.off('connect', on);
      s.off('disconnect', off);
      s.off('connect_error', off);
    };
  }, []);
  return { connected };
}

/** Subscribes to a realtime event; the latest handler is always used without resubscribing. */
export function useSocketEvent<T>(event: RealtimeEvent, handler: (payload: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = getSocket();
    const listener = (payload: T) => ref.current(payload);
    s.on(event, listener);
    return () => {
      s.off(event, listener);
    };
  }, [event]);
}
