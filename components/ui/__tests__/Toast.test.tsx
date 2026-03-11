import { describe, it, expect } from 'vitest';
import type { Toast } from '../Toast';

describe('Toast interface', () => {
  it('should support action property', () => {
    const toast: Toast = {
      id: 'test-1',
      type: 'info',
      message: '代码已更新，是否重新部署？',
      duration: 10000,
      action: {
        label: '重新部署',
        onClick: () => {},
      },
    };

    expect(toast.action).toBeDefined();
    expect(toast.action!.label).toBe('重新部署');
    expect(typeof toast.action!.onClick).toBe('function');
  });

  it('should work without action property (backward compatible)', () => {
    const toast: Toast = {
      id: 'test-2',
      type: 'success',
      message: '操作成功',
    };

    expect(toast.action).toBeUndefined();
  });
});
