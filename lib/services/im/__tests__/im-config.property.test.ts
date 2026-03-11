/**
 * Property-based tests for IM channel configuration persistence.
 *
 * **Feature: im-channel-integration, Property 12: 渠道配置持久化往返**
 * **Validates: Requirements 6.3**
 *
 * Property 12: For any valid IMChannelsSettings object, saving to global
 * config and reloading should yield an equivalent config object (including
 * the receiveMode field).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { IMPlatform, IMChannelConfig, IMChannelsSettings, ReceiveMode } from '../types';

// ---------------------------------------------------------------------------
// Test environment setup
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'im-config-prop-'));
  // Reset modules so settings.ts re-evaluates DATA_DIR with the new env var
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/**
 * Dynamically import settings module after setting SETTINGS_DIR.
 * This forces the module-level DATA_DIR constant to use our temp directory.
 */
async function loadSettingsModule() {
  vi.stubEnv('SETTINGS_DIR', tmpDir);
  const mod = await import('../../settings');
  return mod;
}


// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const allPlatforms: IMPlatform[] = ['wechat', 'feishu', 'dingtalk', 'qq', 'wecom'];
const platformArb = fc.constantFrom<IMPlatform>(...allPlatforms);

const receiveModeArb = fc.constantFrom<ReceiveMode>('stream', 'webhook');

/**
 * Generate a valid IMChannelConfig with realistic field values.
 */
const channelConfigArb: fc.Arbitrary<IMChannelConfig> = fc.record({
  enabled: fc.boolean(),
  receiveMode: receiveModeArb,
  appId: fc.stringMatching(/^[a-zA-Z0-9_]{1,30}$/),
  appSecret: fc.stringMatching(/^[a-zA-Z0-9_]{1,50}$/),
  token: fc.stringMatching(/^[a-zA-Z0-9_]{0,40}$/),
  encodingAESKey: fc.option(fc.stringMatching(/^[a-zA-Z0-9]{0,43}$/), { nil: undefined }),
  extra: fc.option(
    fc.dictionary(
      fc.stringMatching(/^[a-zA-Z0-9_]{1,10}$/),
      fc.stringMatching(/^[a-zA-Z0-9_]{0,20}$/),
      { minKeys: 0, maxKeys: 3 },
    ),
    { nil: undefined },
  ),
});

/**
 * Generate a valid IMChannelsSettings object with 0-5 platform configs.
 */
const channelsSettingsArb: fc.Arbitrary<IMChannelsSettings> = fc.record({
  wechat: fc.option(channelConfigArb, { nil: undefined }),
  feishu: fc.option(channelConfigArb, { nil: undefined }),
  dingtalk: fc.option(channelConfigArb, { nil: undefined }),
  qq: fc.option(channelConfigArb, { nil: undefined }),
  wecom: fc.option(channelConfigArb, { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Property 12: 渠道配置持久化往返
// ---------------------------------------------------------------------------

describe('渠道配置持久化往返 (Property 12)', () => {
  /**
   * **Feature: im-channel-integration, Property 12: 渠道配置持久化往返**
   * **Validates: Requirements 6.3**
   *
   * For any valid IMChannelsSettings object, saving to global config and
   * reloading should yield an equivalent config object including receiveMode.
   */
  it('round-trip: saveChannelConfig then loadChannelConfig preserves all fields including receiveMode', async () => {
    await fc.assert(
      fc.asyncProperty(
        platformArb,
        channelConfigArb,
        async (platform, config) => {
          const { saveChannelConfig, loadChannelConfig } = await loadSettingsModule();

          await saveChannelConfig(platform, config);
          const loaded = await loadChannelConfig(platform);

          expect(loaded).toBeDefined();
          expect(loaded!.enabled).toBe(config.enabled);
          expect(loaded!.receiveMode).toBe(config.receiveMode);
          expect(loaded!.appId).toBe(config.appId);
          expect(loaded!.appSecret).toBe(config.appSecret);
          expect(loaded!.token).toBe(config.token);
          expect(loaded!.encodingAESKey).toBe(config.encodingAESKey);

          // Compare extra field — both undefined or deep equal
          if (config.extra === undefined) {
            expect(loaded!.extra).toBeUndefined();
          } else {
            expect(loaded!.extra).toEqual(config.extra);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Saving config for one platform should not affect other platforms.
   */
  it('saving config for one platform does not affect other platforms', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(platformArb, platformArb).filter(([a, b]) => a !== b),
        channelConfigArb,
        channelConfigArb,
        async ([platformA, platformB], configA, configB) => {
          const { saveChannelConfig, loadChannelConfig } = await loadSettingsModule();

          // Save config for platform A
          await saveChannelConfig(platformA, configA);

          // Save config for platform B
          await saveChannelConfig(platformB, configB);

          // Reload platform A — should still match configA
          const loadedA = await loadChannelConfig(platformA);
          expect(loadedA).toBeDefined();
          expect(loadedA!.enabled).toBe(configA.enabled);
          expect(loadedA!.receiveMode).toBe(configA.receiveMode);
          expect(loadedA!.appId).toBe(configA.appId);
          expect(loadedA!.appSecret).toBe(configA.appSecret);
          expect(loadedA!.token).toBe(configA.token);

          // Reload platform B — should match configB
          const loadedB = await loadChannelConfig(platformB);
          expect(loadedB).toBeDefined();
          expect(loadedB!.enabled).toBe(configB.enabled);
          expect(loadedB!.receiveMode).toBe(configB.receiveMode);
          expect(loadedB!.appId).toBe(configB.appId);
          expect(loadedB!.appSecret).toBe(configB.appSecret);
          expect(loadedB!.token).toBe(configB.token);
        },
      ),
      { numRuns: 100 },
    );
  });
});
