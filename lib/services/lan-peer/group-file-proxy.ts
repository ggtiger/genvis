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
 * Resolve the proxy base URL for a group's creator node.
 * 
 * @param groupId - The group ID (same ID used as projectId in /api/repo/ routes)
 * @returns Base URL like "http://192.168.1.5:3000", or null if not a group / creator offline
 */
export async function resolveGroupProxyUrl(groupId: string): Promise<string | null> {
  // Check if this is a known group
  const group = await getGroup(groupId);
  if (!group) return null;

  const manager = getLanPeerManager();
  if (!manager) return null;

  const peers = manager.discovery.getRegistry().getPeers();
  const creator = peers.find((p) => p.id === group.creatorId);
  if (!creator || creator.status !== 'online') return null;

  return `http://${creator.ip}:${creator.httpPort}`;
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
