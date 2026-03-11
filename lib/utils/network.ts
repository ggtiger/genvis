/**
 * Network utilities for getting LAN IP addresses
 */
import os from 'os';

export interface NetworkInfo {
  ip: string;
  family: 'IPv4' | 'IPv6';
  interface: string;
}

/**
 * Get all LAN IP addresses (192.168.x.x or 10.x.x.x)
 */
export function getLanIPs(): NetworkInfo[] {
  const interfaces = os.networkInterfaces();
  const lanIPs: NetworkInfo[] = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue;

    for (const addr of addresses) {
      // Skip internal (loopback) addresses
      if (addr.internal) continue;

      // Only IPv4
      if (addr.family !== 'IPv4') continue;

      const ip = addr.address;

      // Filter LAN addresses: 192.168.x.x or 10.x.x.x or 172.16-31.x.x
      if (
        ip.startsWith('192.168.') ||
        ip.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
      ) {
        lanIPs.push({
          ip,
          family: 'IPv4',
          interface: name,
        });
      }
    }
  }

  return lanIPs;
}

/**
 * Get the primary LAN IP (first match)
 */
export function getPrimaryLanIP(): string | null {
  const lanIPs = getLanIPs();
  return lanIPs.length > 0 ? lanIPs[0].ip : null;
}
