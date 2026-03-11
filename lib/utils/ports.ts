import net from 'net';

const MAX_PORT = 65_535;
const FALLBACK_PORT_START = 3_135;
const FALLBACK_PORT_END = 3_999;
const DEFAULT_RANGE_SPAN = FALLBACK_PORT_END - FALLBACK_PORT_START;

function normalizePortInput(value?: number | string | null): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric =
    typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);

  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > MAX_PORT) {
    return null;
  }

  return numeric;
}

function resolveDefaultBounds(): { start: number; end: number } {
  const envStart =
    normalizePortInput(process.env.PREVIEW_PORT_START) ?? FALLBACK_PORT_START;

  const envEndCandidate = normalizePortInput(process.env.PREVIEW_PORT_END);

  const fallbackEnd = Math.min(envStart + DEFAULT_RANGE_SPAN, MAX_PORT);
  const envEnd =
    envEndCandidate && envEndCandidate >= envStart
      ? envEndCandidate
      : fallbackEnd;

  return { start: envStart, end: envEnd };
}

async function checkPort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    let resolved = false;

    const cleanup = (available: boolean) => {
      if (resolved) return;
      resolved = true;
      try {
        server.close();
      } catch {
        // Ignore errors while closing
      }
      resolve(available);
    };

    server.once('error', () => cleanup(false)); // 端口被占用
    server.once('listening', () => cleanup(true)); // 端口可用

    // 超时保护
    setTimeout(() => cleanup(false), 500);

    try {
      server.listen(port, host);
    } catch {
      cleanup(false);
    }
  });
}

async function isPortAvailable(port: number): Promise<boolean> {
  const results = await Promise.allSettled([
    checkPort('0.0.0.0', port),   // IPv4 通配
    checkPort('::', port),         // IPv6 通配
    checkPort('127.0.0.1', port), // IPv4 回环
    checkPort('::1', port),        // IPv6 回环
  ]);

  // IPv4 必须都可用，IPv6 失败忽略
  return results[0].status === 'fulfilled' && results[0].value &&
         results[2].status === 'fulfilled' && results[2].value;
}

export async function findAvailablePort(
  startPort?: number,
  endPort?: number
): Promise<number> {
  const { start: defaultStart, end: defaultEnd } = resolveDefaultBounds();

  const explicitStart = normalizePortInput(startPort);
  const explicitEnd = normalizePortInput(endPort);

  let rangeStart =
    explicitStart ?? normalizePortInput(process.env.PORT) ?? defaultStart;
  rangeStart = Math.max(1, rangeStart);

  if (rangeStart > MAX_PORT) {
    throw new Error(
      `Unable to determine a valid starting port (computed ${rangeStart}).`
    );
  }

  let rangeEnd = explicitEnd ?? defaultEnd;
  if (explicitStart && !explicitEnd) {
    rangeEnd = Math.min(explicitStart + DEFAULT_RANGE_SPAN, MAX_PORT);
  }
  rangeEnd = Math.max(rangeStart, Math.min(rangeEnd, MAX_PORT));

  if (rangeEnd < rangeStart) {
    throw new Error(
      `Unable to determine a valid port range (start ${rangeStart}, end ${rangeEnd}).`
    );
  }

  for (let port = rangeStart; port <= rangeEnd; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }

  throw new Error(
    `Unable to find an available port between ${rangeStart} and ${rangeEnd}.`
  );
}
