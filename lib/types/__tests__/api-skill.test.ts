import { describe, it, expect } from 'vitest';
import {
  createEmptyRegistry,
  validateApiEndpointsConfig,
  type ApiEndpointsConfig,
  type ApiSkillRegistryData,
} from '../api-skill';

/**
 * Unit tests for API skill type definitions and validation.
 * Validates: Requirements 1.1, 1.3, 1.4
 */

describe('createEmptyRegistry', () => {
  it('should return a registry with version 1', () => {
    const registry = createEmptyRegistry();
    expect(registry.version).toBe(1);
  });

  it('should return a registry with empty skills array', () => {
    const registry = createEmptyRegistry();
    expect(registry.skills).toEqual([]);
  });

  it('should return a registry with a valid ISO timestamp', () => {
    const registry = createEmptyRegistry();
    expect(new Date(registry.updatedAt).toISOString()).toBe(registry.updatedAt);
  });

  it('should return a new object each time', () => {
    const a = createEmptyRegistry();
    const b = createEmptyRegistry();
    expect(a).not.toBe(b);
    expect(a.skills).not.toBe(b.skills);
  });
});

describe('validateApiEndpointsConfig', () => {
  const validConfig: ApiEndpointsConfig = {
    skillName: 'test-skill',
    displayName: '测试技能',
    description: '这是一个测试技能',
    endpoints: [
      {
        path: '/api/test',
        method: 'GET',
        description: '测试端点',
      },
    ],
  };

  describe('valid configs', () => {
    it('should accept a minimal valid config', () => {
      const result = validateApiEndpointsConfig(validConfig);
      expect(result).not.toBeNull();
      expect(result!.skillName).toBe('test-skill');
    });

    it('should accept a config with auth (none)', () => {
      const config = { ...validConfig, auth: { authType: 'none' as const } };
      expect(validateApiEndpointsConfig(config)).not.toBeNull();
    });

    it('should accept a config with auth (api-key) and envVars', () => {
      const config = {
        ...validConfig,
        auth: { authType: 'api-key' as const, envVars: ['API_KEY'] },
      };
      expect(validateApiEndpointsConfig(config)).not.toBeNull();
    });

    it('should accept a config with auth (oauth)', () => {
      const config = {
        ...validConfig,
        auth: { authType: 'oauth' as const, envVars: ['CLIENT_ID', 'CLIENT_SECRET'] },
      };
      expect(validateApiEndpointsConfig(config)).not.toBeNull();
    });

    it('should accept endpoints with parameters', () => {
      const config: ApiEndpointsConfig = {
        ...validConfig,
        endpoints: [
          {
            path: '/api/test',
            method: 'POST',
            description: '创建测试',
            parameters: [
              { name: 'title', type: 'string', required: true, description: '标题' },
              { name: 'count', type: 'number', required: false, description: '数量' },
            ],
          },
        ],
      };
      expect(validateApiEndpointsConfig(config)).not.toBeNull();
    });

    it('should accept endpoints with responseFields', () => {
      const config: ApiEndpointsConfig = {
        ...validConfig,
        endpoints: [
          {
            path: '/api/test',
            method: 'GET',
            description: '查询测试',
            responseDescription: '返回测试列表',
            responseFields: [
              { name: 'id', type: 'string', description: '测试 ID' },
              { name: 'items', type: 'array', description: '测试项列表' },
            ],
          },
        ],
      };
      expect(validateApiEndpointsConfig(config)).not.toBeNull();
    });

    it('should accept all HTTP methods', () => {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE'] as const) {
        const config: ApiEndpointsConfig = {
          ...validConfig,
          endpoints: [{ path: '/api/test', method, description: '测试' }],
        };
        expect(validateApiEndpointsConfig(config)).not.toBeNull();
      }
    });
  });

  describe('invalid inputs', () => {
    it('should reject null', () => {
      expect(validateApiEndpointsConfig(null)).toBeNull();
    });

    it('should reject undefined', () => {
      expect(validateApiEndpointsConfig(undefined)).toBeNull();
    });

    it('should reject a string', () => {
      expect(validateApiEndpointsConfig('not an object')).toBeNull();
    });

    it('should reject a number', () => {
      expect(validateApiEndpointsConfig(42)).toBeNull();
    });

    it('should reject an array', () => {
      expect(validateApiEndpointsConfig([])).toBeNull();
    });
  });

  describe('missing required fields', () => {
    it('should reject missing skillName', () => {
      const { skillName, ...rest } = validConfig;
      expect(validateApiEndpointsConfig(rest)).toBeNull();
    });

    it('should reject empty skillName', () => {
      expect(validateApiEndpointsConfig({ ...validConfig, skillName: '' })).toBeNull();
    });

    it('should reject missing displayName', () => {
      const { displayName, ...rest } = validConfig;
      expect(validateApiEndpointsConfig(rest)).toBeNull();
    });

    it('should reject empty displayName', () => {
      expect(validateApiEndpointsConfig({ ...validConfig, displayName: '' })).toBeNull();
    });

    it('should reject missing description', () => {
      const { description, ...rest } = validConfig;
      expect(validateApiEndpointsConfig(rest)).toBeNull();
    });

    it('should reject empty description', () => {
      expect(validateApiEndpointsConfig({ ...validConfig, description: '' })).toBeNull();
    });

    it('should reject missing endpoints', () => {
      const { endpoints, ...rest } = validConfig;
      expect(validateApiEndpointsConfig(rest)).toBeNull();
    });

    it('should reject empty endpoints array', () => {
      expect(validateApiEndpointsConfig({ ...validConfig, endpoints: [] })).toBeNull();
    });

    it('should reject endpoints that is not an array', () => {
      expect(validateApiEndpointsConfig({ ...validConfig, endpoints: 'not-array' })).toBeNull();
    });
  });

  describe('invalid endpoint fields', () => {
    it('should reject endpoint missing path', () => {
      const config = {
        ...validConfig,
        endpoints: [{ method: 'GET', description: '测试' }],
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });

    it('should reject endpoint with empty path', () => {
      const config = {
        ...validConfig,
        endpoints: [{ path: '', method: 'GET', description: '测试' }],
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });

    it('should reject endpoint missing method', () => {
      const config = {
        ...validConfig,
        endpoints: [{ path: '/api/test', description: '测试' }],
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });

    it('should reject endpoint with invalid method', () => {
      const config = {
        ...validConfig,
        endpoints: [{ path: '/api/test', method: 'PATCH', description: '测试' }],
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });

    it('should reject endpoint missing description', () => {
      const config = {
        ...validConfig,
        endpoints: [{ path: '/api/test', method: 'GET' }],
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });
  });

  describe('invalid auth', () => {
    it('should reject auth with invalid authType', () => {
      const config = {
        ...validConfig,
        auth: { authType: 'basic' },
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });

    it('should reject auth with non-array envVars', () => {
      const config = {
        ...validConfig,
        auth: { authType: 'api-key', envVars: 'API_KEY' },
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });

    it('should reject auth with non-string items in envVars', () => {
      const config = {
        ...validConfig,
        auth: { authType: 'api-key', envVars: [123] },
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });
  });

  describe('invalid parameters', () => {
    it('should reject parameter missing name', () => {
      const config = {
        ...validConfig,
        endpoints: [
          {
            path: '/api/test',
            method: 'POST',
            description: '测试',
            parameters: [{ type: 'string', required: true, description: '描述' }],
          },
        ],
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });

    it('should reject parameter missing type', () => {
      const config = {
        ...validConfig,
        endpoints: [
          {
            path: '/api/test',
            method: 'POST',
            description: '测试',
            parameters: [{ name: 'title', required: true, description: '描述' }],
          },
        ],
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });

    it('should reject parameter missing required', () => {
      const config = {
        ...validConfig,
        endpoints: [
          {
            path: '/api/test',
            method: 'POST',
            description: '测试',
            parameters: [{ name: 'title', type: 'string', description: '描述' }],
          },
        ],
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });

    it('should reject parameter with non-boolean required', () => {
      const config = {
        ...validConfig,
        endpoints: [
          {
            path: '/api/test',
            method: 'POST',
            description: '测试',
            parameters: [{ name: 'title', type: 'string', required: 'yes', description: '描述' }],
          },
        ],
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });

    it('should reject parameter missing description', () => {
      const config = {
        ...validConfig,
        endpoints: [
          {
            path: '/api/test',
            method: 'POST',
            description: '测试',
            parameters: [{ name: 'title', type: 'string', required: true }],
          },
        ],
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });
  });

  describe('invalid responseFields', () => {
    it('should reject responseField missing name', () => {
      const config = {
        ...validConfig,
        endpoints: [
          {
            path: '/api/test',
            method: 'GET',
            description: '测试',
            responseFields: [{ type: 'string', description: '描述' }],
          },
        ],
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });

    it('should reject responseField missing type', () => {
      const config = {
        ...validConfig,
        endpoints: [
          {
            path: '/api/test',
            method: 'GET',
            description: '测试',
            responseFields: [{ name: 'id', description: '描述' }],
          },
        ],
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });

    it('should reject responseField missing description', () => {
      const config = {
        ...validConfig,
        endpoints: [
          {
            path: '/api/test',
            method: 'GET',
            description: '测试',
            responseFields: [{ name: 'id', type: 'string' }],
          },
        ],
      };
      expect(validateApiEndpointsConfig(config)).toBeNull();
    });
  });

  describe('JSON round-trip', () => {
    it('should survive JSON serialization and deserialization', () => {
      const fullConfig: ApiEndpointsConfig = {
        skillName: 'productivity-hub',
        displayName: '个人效率助手',
        description: '管理待办事项、日程安排和笔记的效率工具',
        auth: { authType: 'none' },
        endpoints: [
          {
            path: '/api/todos',
            method: 'POST',
            description: '创建待办事项',
            parameters: [
              { name: 'title', type: 'string', required: true, description: '待办标题' },
            ],
            responseDescription: '创建成功的待办对象',
            responseFields: [
              { name: 'id', type: 'string', description: '待办 ID' },
            ],
          },
        ],
      };

      const json = JSON.stringify(fullConfig);
      const parsed = JSON.parse(json);
      const validated = validateApiEndpointsConfig(parsed);

      expect(validated).not.toBeNull();
      expect(validated).toEqual(fullConfig);
    });
  });
});
