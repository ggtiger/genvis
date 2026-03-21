/**
 * LAN Peer Chat — Message Interaction Mode Parser
 *
 * Parses message content to determine the interaction mode:
 * - `@名称 内容` → mention mode
 * - `#内容` → plain mode (explicit plain chat)
 * - other + group has skills → skill_invoke mode
 * - other + no skills → plain mode
 *
 * Requirements: 2.5.1, 2.5.2, 2.5.3, 2.5.5
 */

import type { MessageInteractionMode } from './types';

/**
 * Parse a message string into its interaction mode.
 *
 * @param content  Raw message content
 * @param enabledSkills  Skills enabled for the current group
 */
export function parseInteractionMode(
  content: string,
  enabledSkills: string[] = [],
): MessageInteractionMode {
  const trimmed = content.trim();

  // Empty → plain
  if (!trimmed) {
    return { mode: 'plain', cleanContent: '' };
  }

  // `@名称 内容` → mention
  if (trimmed.startsWith('@')) {
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx > 1) {
      const mentionedName = trimmed.slice(1, spaceIdx);
      const cleanContent = trimmed.slice(spaceIdx + 1).trim();
      return { mode: 'mention', mentionedPeerName: mentionedName, cleanContent };
    }
    // `@名称` without trailing content — still mention, content is empty
    if (trimmed.length > 1) {
      return { mode: 'mention', mentionedPeerName: trimmed.slice(1), cleanContent: '' };
    }
    // Just `@` alone → plain
    return { mode: 'plain', cleanContent: trimmed };
  }

  // `#内容` → no_ai (explicit plain chat, skip AI response)
  if (trimmed.startsWith('#')) {
    return { mode: 'no_ai', cleanContent: trimmed.slice(1).trim() };
  }

  // Default: skill_invoke if group has skills, otherwise plain
  if (enabledSkills.length > 0) {
    return { mode: 'skill_invoke', cleanContent: trimmed };
  }

  return { mode: 'plain', cleanContent: trimmed };
}
