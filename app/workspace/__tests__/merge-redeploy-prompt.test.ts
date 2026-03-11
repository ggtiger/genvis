import { describe, it, expect } from 'vitest';

/**
 * Tests for the merge-redeploy prompt logic.
 * After a successful merge back to skill, the UI should check deploy status
 * and prompt for redeploy only when the skill has a local deploy.
 */

function shouldPromptRedeploy(deployData: { success: boolean; data?: { local?: { status: string } } }): boolean {
  if (!deployData.success) return false;
  const localStatus = deployData.data?.local?.status;
  return localStatus === 'deployed' || localStatus === 'stopped';
}

describe('merge-redeploy prompt logic', () => {
  it('should prompt when skill is locally deployed', () => {
    expect(shouldPromptRedeploy({
      success: true,
      data: { local: { status: 'deployed' } },
    })).toBe(true);
  });

  it('should prompt when skill is stopped', () => {
    expect(shouldPromptRedeploy({
      success: true,
      data: { local: { status: 'stopped' } },
    })).toBe(true);
  });

  it('should not prompt when skill is not deployed', () => {
    expect(shouldPromptRedeploy({
      success: true,
      data: { local: { status: 'not_deployed' } },
    })).toBe(false);
  });

  it('should not prompt when skill build failed', () => {
    expect(shouldPromptRedeploy({
      success: true,
      data: { local: { status: 'build_failed' } },
    })).toBe(false);
  });

  it('should not prompt when skill is building', () => {
    expect(shouldPromptRedeploy({
      success: true,
      data: { local: { status: 'building' } },
    })).toBe(false);
  });

  it('should not prompt when deploy status fetch fails', () => {
    expect(shouldPromptRedeploy({ success: false })).toBe(false);
  });

  it('should not prompt when local data is missing', () => {
    expect(shouldPromptRedeploy({ success: true, data: {} })).toBe(false);
  });
});
