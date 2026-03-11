'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface TerminalEmulatorProps {
  sessionId: string;
  workingDirectory?: string;
  onSessionEnd?: () => void;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const POLL_INTERVAL_MS = 100;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

export default function TerminalEmulator({
  sessionId,
  onSessionEnd,
}: TerminalEmulatorProps) {
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const isMountedRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The actual server-side session ID (may differ from the prop)
  const serverSessionIdRef = useRef<string | null>(null);

  /** Creates the terminal session on the server. */
  const createSession = useCallback(async (): Promise<{ sessionId: string; created: boolean; scrollback?: string } | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/terminal/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'create' }),
      });
      const data = await res.json();
      if (data.ok) {
        return { sessionId: data.sessionId, created: data.created, scrollback: data.scrollback };
      }
      console.error('[Terminal] Create session failed:', data.error);
      return null;
    } catch (e) {
      console.error('[Terminal] Create session error:', e);
      return null;
    }
  }, [sessionId]);

  /** Sends input to the terminal. */
  const sendInput = useCallback(async (input: string) => {
    if (!serverSessionIdRef.current) return;
    try {
      await fetch(`${API_BASE}/api/terminal/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'input', data: input }),
      });
    } catch {
      // Ignore transient send failures
    }
  }, [sessionId]);

  /** Sends resize to the terminal. */
  const sendResize = useCallback(async (cols: number, rows: number) => {
    if (!serverSessionIdRef.current) return;
    try {
      await fetch(`${API_BASE}/api/terminal/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'resize', cols, rows }),
      });
    } catch {
      // Ignore
    }
  }, [sessionId]);

  /** Polls for output from the terminal. */
  const pollOutput = useCallback(async () => {
    if (!serverSessionIdRef.current || !isMountedRef.current) return;

    try {
      const res = await fetch(`${API_BASE}/api/terminal/${sessionId}`);
      const data = await res.json();

      if (!isMountedRef.current) return;

      const terminal = terminalRef.current;
      if (terminal && data.output) {
        terminal.write(data.output);
      }

      if (data.exitCode !== undefined) {
        terminal?.writeln(
          `\r\n\x1b[33m[Process exited with code ${data.exitCode}]\x1b[0m`
        );
        onSessionEnd?.();
        setConnectionStatus('disconnected');
        return; // Stop polling
      }
    } catch {
      // Transient fetch error — keep polling
    }

    // Schedule next poll
    if (isMountedRef.current) {
      pollTimerRef.current = setTimeout(pollOutput, POLL_INTERVAL_MS);
    }
  }, [onSessionEnd]);

  /** Main effect: init terminal, create session, start polling. */
  useEffect(() => {
    isMountedRef.current = true;

    const container = terminalContainerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
    });
    terminalRef.current = terminal;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);

    try { fitAddon.fit(); } catch { /* zero-size container */ }

    // Forward user keystrokes to the server
    const dataDisposable = terminal.onData((data: string) => {
      sendInput(data);
    });

    // Observe container resizes
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
      sendResize(terminal.cols, terminal.rows);
    });
    resizeObserver.observe(container);

    // Create session and start polling
    (async () => {
      const result = await createSession();
      if (!isMountedRef.current) return;

      if (!result) {
        setConnectionStatus('disconnected');
        terminal.writeln('\x1b[31m[Failed to create terminal session]\x1b[0m');
        return;
      }

      serverSessionIdRef.current = result.sessionId;
      setConnectionStatus('connected');

      if (result.created) {
        // New session: show welcome banner
        terminal.writeln('\x1b[36m╭──────────────────────────────────────────╮\x1b[0m');
        terminal.writeln('\x1b[36m│\x1b[0m  \x1b[1m命令行终端\x1b[0m                              \x1b[36m│\x1b[0m');
        terminal.writeln('\x1b[36m│\x1b[0m  可直接输入任意 Shell 命令               \x1b[36m│\x1b[0m');
        terminal.writeln('\x1b[36m│\x1b[0m  支持交互式工具，如 claude、vim、top 等  \x1b[36m│\x1b[0m');
        terminal.writeln('\x1b[36m╰──────────────────────────────────────────╯\x1b[0m');
        terminal.writeln('');
      } else if (result.scrollback) {
        // Existing session: replay scrollback history
        terminal.write(result.scrollback);
      }

      // Send initial resize
      sendResize(terminal.cols, terminal.rows);

      // Start polling for output
      pollOutput();
    })();

    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      resizeObserver.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      serverSessionIdRef.current = null;
    };
  }, [createSession, sendInput, sendResize, pollOutput]);

  const statusColor: Record<ConnectionStatus, string> = {
    connected: 'bg-green-500',
    connecting: 'bg-yellow-500',
    disconnected: 'bg-red-500',
  };

  const statusLabel: Record<ConnectionStatus, string> = {
    connected: '已连接',
    connecting: '连接中...',
    disconnected: '已断开',
  };

  return (
    <div className="relative flex flex-col w-full h-full">
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/50 text-xs text-white/80">
        <span className={`inline-block w-2 h-2 rounded-full ${statusColor[connectionStatus]}`} />
        <span>{statusLabel[connectionStatus]}</span>
      </div>
      <div
        ref={terminalContainerRef}
        className="flex-1 w-full"
        style={{ backgroundColor: '#1e1e1e' }}
      />
    </div>
  );
}
