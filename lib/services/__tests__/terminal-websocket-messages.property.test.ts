/**
 * Property-based tests for WebSocket message serialization roundtrip.
 *
 * Uses fast-check to generate random TerminalClientMessage and TerminalServerMessage
 * objects, serializes them to JSON, parses them back, and verifies deep equality.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Client → Server message types as defined in the design document.
 */
type TerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

/**
 * Server → Client message types as defined in the design document.
 */
type TerminalServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string }
  | { type: 'connected'; sessionId: string };

/**
 * Arbitrary generator for TerminalClientMessage objects.
 * Generates either 'input' messages with arbitrary string data
 * or 'resize' messages with arbitrary cols/rows numbers.
 */
const clientMessageArb: fc.Arbitrary<TerminalClientMessage> = fc.oneof(
  fc.record({
    type: fc.constant('input' as const),
    data: fc.string(),
  }),
  fc.record({
    type: fc.constant('resize' as const),
    cols: fc.integer({ min: 1, max: 500 }),
    rows: fc.integer({ min: 1, max: 200 }),
  })
);

/**
 * Arbitrary generator for TerminalServerMessage objects.
 * Generates one of: 'output', 'exit', 'error', or 'connected' messages.
 */
const serverMessageArb: fc.Arbitrary<TerminalServerMessage> = fc.oneof(
  fc.record({
    type: fc.constant('output' as const),
    data: fc.string(),
  }),
  fc.record({
    type: fc.constant('exit' as const),
    code: fc.integer({ min: -128, max: 255 }),
  }),
  fc.record({
    type: fc.constant('error' as const),
    message: fc.string(),
  }),
  fc.record({
    type: fc.constant('connected' as const),
    sessionId: fc.uuid(),
  })
);

describe('WebSocket Message Serialization Property Tests', () => {
  /**
   * Property 3: WebSocket 消息序列化往返
   *
   * For any valid TerminalClientMessage object, serializing it to JSON
   * and then parsing it back SHALL produce an equivalent object with
   * the same type and data fields.
   *
   * **Validates: Requirements 4.1, 4.2, 4.3**
   */
  it('Property 3: ClientMessage serialization roundtrip - JSON.stringify then JSON.parse produces deeply equal object', () => {
    fc.assert(
      fc.property(clientMessageArb, (message) => {
        const serialized = JSON.stringify(message);
        const deserialized = JSON.parse(serialized);

        expect(deserialized).toEqual(message);

        // Verify type field is preserved
        expect(deserialized.type).toBe(message.type);

        // Verify type-specific fields are preserved
        if (message.type === 'input') {
          expect(deserialized.data).toBe(message.data);
        } else if (message.type === 'resize') {
          expect(deserialized.cols).toBe(message.cols);
          expect(deserialized.rows).toBe(message.rows);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: WebSocket 消息序列化往返 (ServerMessage)
   *
   * For any valid TerminalServerMessage object, serializing it to JSON
   * and then parsing it back SHALL produce an equivalent object with
   * the same type and data fields.
   *
   * **Validates: Requirements 4.1, 4.2, 4.3**
   */
  it('Property 3: ServerMessage serialization roundtrip - JSON.stringify then JSON.parse produces deeply equal object', () => {
    fc.assert(
      fc.property(serverMessageArb, (message) => {
        const serialized = JSON.stringify(message);
        const deserialized = JSON.parse(serialized);

        expect(deserialized).toEqual(message);

        // Verify type field is preserved
        expect(deserialized.type).toBe(message.type);

        // Verify type-specific fields are preserved
        if (message.type === 'output') {
          expect(deserialized.data).toBe(message.data);
        } else if (message.type === 'exit') {
          expect(deserialized.code).toBe(message.code);
        } else if (message.type === 'error') {
          expect(deserialized.message).toBe(message.message);
        } else if (message.type === 'connected') {
          expect(deserialized.sessionId).toBe(message.sessionId);
        }
      }),
      { numRuns: 100 }
    );
  });
});
