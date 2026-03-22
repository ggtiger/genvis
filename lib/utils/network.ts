/**
 * Network utilities for getting LAN IP addresses
 */
import os from 'os';

export interface NetworkInfo {
  ip: string;
  family: 'IPv4' | 'IPv6';
  interface: string;
  netmask?: string;
  broadcast?: string;
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
        // Calculate subnet broadcast address from IP and netmask
        const netmask = addr.netmask || '255.255.255.0';
        const broadcast = calculateBroadcast(ip, netmask);
        lanIPs.push({
          ip,
          family: 'IPv4',
          interface: name,
          netmask,
          broadcast,
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

/**
 * Get all subnet broadcast addresses for LAN interfaces
 */
export function getLanBroadcastAddresses(): string[] {
  const lanIPs = getLanIPs();
  const addrs = new Set<string>();
  for (const info of lanIPs) {
    if (info.broadcast) addrs.add(info.broadcast);
  }
  // Always include limited broadcast as fallback
  addrs.add('255.255.255.255');
  return Array.from(addrs);
}

/**
 * Calculate broadcast address from IP and netmask
 */
function calculateBroadcast(ip: string, netmask: string): string {
  const ipParts = ip.split('.').map(Number);
  const maskParts = netmask.split('.').map(Number);
  return ipParts.map((octet, i) => (octet | (~maskParts[i] & 0xff))).join('.');
}
