/**
 * Group File Proxy Helper
 * 
 * When a remote group member accesses /api/repo/{groupId}/..., the project lookup
 * returns null because the workspace only exists on the creator's machine.
 * This helper resolves the creator's proxy base URL so the API route can forward
 * the request to the creator's node.
 * 
 * Flow:
 *   1. Check if groupId corresponds to a known group (group.json exists)
 *   2. Look up the creator peer's network info (IP + httpPort)
 *   3. Return the proxy base URL if the creator is online
 */

import { getGroup } from './chat-service';
import { getLanPeerManager } from './manager';

/**
 * Extract baseMachineId from peerId by stripping the -p{port} suffix.
 * e.g. "a1b2c3d4-p3000" -> "a1b2c3d4"
 * Only used for peer registry lookup fallback (cross-machine port change), NOT for identity checks.
 */
export function extractBaseMachineId(peerId: string): string {
  return peerId.replace(/-p\d+$/, '');
}

/**
 * Resolve the proxy base URL for a group's creator node.
 * 
 * @param groupId - The group ID (same ID used as projectId in /api/repo/ routes)
 * @returns Base URL like "http://192.168.1.5:3000", or null if not a group / creator offline
 */
export async function resolveGroupProxyUrl(groupId: string): Promise<string | null> {
  // Check if this is a known group
  const group = await getGroup(groupId);
  if (!group) {
    console.log(`[GroupFileProxy] Group not found locally: ${groupId}`);
    return null;
  }

  const manager = getLanPeerManager();
  if (!manager) {
    console.log(`[GroupFileProxy] LanPeerManager not initialized`);
    return null;
  }

  // Check if WE are the creator — EXACT peerId match
  // (same machine with different ports = different instances, must NOT match)
  if (group.creatorId === manager.peerId) {
    return null;
  }

  const peers = manager.discovery.getRegistry().getPeers();

  // 1. Exact peerId match in registry
  let creator = peers.find((p) => p.id === group.creatorId && p.status === 'online');

  // 2. Fallback: baseMachineId match (handles cross-machine port change after restart)
  //    Exclude self to avoid matching another instance on the same machine
  if (!creator) {
    const creatorBase = extractBaseMachineId(group.creatorId);
    const myBase = extractBaseMachineId(manager.peerId);
    if (creatorBase !== myBase) {
      // Only use fallback for cross-machine scenario (different baseMachineId)
      creator = peers.find((p) => extractBaseMachineId(p.id) === creatorBase && p.status === 'online');
      if (creator) {
        console.log(`[GroupFileProxy] Matched creator by baseMachineId fallback: ${group.creatorId} -> ${creator.id}`);
      }
    }
  }

  if (!creator) {
    console.log(`[GroupFileProxy] Creator peer not found in registry: ${group.creatorId} (known peers: ${peers.map(p => p.id).join(', ')})`);
    return null;
  }
  if (creator.status !== 'online') {
    console.log(`[GroupFileProxy] Creator peer offline: ${creator.id}`);
    return null;
  }

  const url = `http://${creator.ip}:${creator.httpPort}`;

  // If creator is on the same machine, use 127.0.0.1 instead of LAN IP
  // This handles the case where Next.js only listens on localhost
  try {
    const { getPrimaryLanIP } = await import('@/lib/utils/network');
    const localIP = getPrimaryLanIP();
    if (localIP && creator.ip === localIP) {
      const localUrl = `http://127.0.0.1:${creator.httpPort}`;
      console.log(`[GroupFileProxy] Creator on same machine, using localhost: ${localUrl}`);
      return localUrl;
    }
  } catch {}

  console.log(`[GroupFileProxy] Resolved proxy URL for group ${groupId}: ${url}`);
  return url;
}

/**
 * Proxy a GET request to the group creator's node and return the response.
 * Forwards the same URL path and query string.
 */
export async function proxyGroupGet(
  proxyBaseUrl: string,
  urlPath: string,
  timeoutMs = 15000,
): Promise<Response> {
  const proxyUrl = `${proxyBaseUrl}${urlPath}`;
  return fetch(proxyUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Proxy a POST request (JSON body) to the group creator's node.
 */
export async function proxyGroupPost(
  proxyBaseUrl: string,
  urlPath: string,
  body: unknown,
  timeoutMs = 15000,
): Promise<Response> {
  const proxyUrl = `${proxyBaseUrl}${urlPath}`;
  return fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Proxy a PUT request (FormData for uploads) to the group creator's node.
 */
export async function proxyGroupPut(
  proxyBaseUrl: string,
  urlPath: string,
  formData: FormData,
  timeoutMs = 30000,
): Promise<Response> {
  const proxyUrl = `${proxyBaseUrl}${urlPath}`;
  return fetch(proxyUrl, {
    method: 'PUT',
    body: formData,
    signal: AbortSignal.timeout(timeoutMs),
  });
}
