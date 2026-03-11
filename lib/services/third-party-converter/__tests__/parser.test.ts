import { describe, it, expect } from 'vitest';
import { parseOpenClawYaml, parseOpenClawJson, parseSkillManifest } from '../parser';

const validYaml = `
name: my-skill
description: A test skill
version: "1.0.0"
author: tester
tags:
  - ai
  - tool
runtime: python
entryPoint: main.py
envVars:
  - key: API_KEY
    label: API Key
    required: true
    secret: true
  - key: DEBUG
    required: false
    defaultValue: "false"
`;

const validJson = JSON.stringify({
  name: 'my-skill',
  description: 'A test skill',
  version: '1.0.0',
  author: 'tester',
  tags: ['ai', 'tool'],
  runtime: 'python',
  entryPoint: 'main.py',
  envVars: [
    { key: 'API_KEY', label: 'API Key', required: true, secret: true },
    { key: 'DEBUG', required: false, defaultValue: 'false' },
  ],
});

describe('parseOpenClawYaml', () => {
  it('parses a valid YAML config', () => {
    const result = parseOpenClawYaml(validYaml);
    expect(result.name).toBe('my-skill');
    expect(result.description).toBe('A test skill');
    expect(result.version).toBe('1.0.0');
    expect(result.author).toBe('tester');
    expect(result.tags).toEqual(['ai', 'tool']);
    expect(result.runtime).toBe('python');
    expect(result.entryPoint).toBe('main.py');
    expect(result.envVars).toHaveLength(2);
    expect(result.envVars![0].key).toBe('API_KEY');
    expect(result.envVars![0].secret).toBe(true);
    expect(result.envVars![1].defaultValue).toBe('false');
    expect(result.sourcePlatform).toBe('openclaw');
    expect(result.sourceUrl).toBe('');
    expect(result.rawConfig).toBeDefined();
  });

  it('throws on missing name', () => {
    const yaml = `description: hello`;
    expect(() => parseOpenClawYaml(yaml)).toThrow('Missing required fields: name');
  });

  it('throws on missing description', () => {
    const yaml = `name: test`;
    expect(() => parseOpenClawYaml(yaml)).toThrow('Missing required fields: description');
  });

  it('throws listing all missing required fields', () => {
    const yaml = `version: "1.0"`;
    expect(() => parseOpenClawYaml(yaml)).toThrow('Missing required fields: name, description');
  });

  it('ignores unknown fields', () => {
    const yaml = `
name: test
description: desc
unknownField: should-be-ignored
anotherUnknown: 42
`;
    const result = parseOpenClawYaml(yaml);
    expect(result.name).toBe('test');
    expect(result.description).toBe('desc');
    expect((result as unknown as Record<string, unknown>).unknownField).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).anotherUnknown).toBeUndefined();
    // But rawConfig preserves them
    expect(result.rawConfig!.unknownField).toBe('should-be-ignored');
  });

  it('maps unrecognized runtime to unknown', () => {
    const yaml = `
name: test
description: desc
runtime: ruby
`;
    const result = parseOpenClawYaml(yaml);
    expect(result.runtime).toBe('unknown');
  });

  it('throws on non-object YAML', () => {
    expect(() => parseOpenClawYaml('just a string')).toThrow('Invalid YAML: expected an object');
  });

  it('throws on YAML array', () => {
    expect(() => parseOpenClawYaml('- item1\n- item2')).toThrow('Invalid YAML: expected an object');
  });
});

describe('parseOpenClawJson', () => {
  it('parses a valid JSON config', () => {
    const result = parseOpenClawJson(validJson);
    expect(result.name).toBe('my-skill');
    expect(result.description).toBe('A test skill');
    expect(result.version).toBe('1.0.0');
    expect(result.runtime).toBe('python');
    expect(result.envVars).toHaveLength(2);
    expect(result.sourcePlatform).toBe('openclaw');
  });

  it('throws on missing required fields', () => {
    const json = JSON.stringify({ version: '1.0' });
    expect(() => parseOpenClawJson(json)).toThrow('Missing required fields: name, description');
  });

  it('ignores unknown fields in JSON', () => {
    const json = JSON.stringify({
      name: 'test',
      description: 'desc',
      foo: 'bar',
      baz: 123,
    });
    const result = parseOpenClawJson(json);
    expect(result.name).toBe('test');
    expect((result as unknown as Record<string, unknown>).foo).toBeUndefined();
    expect(result.rawConfig!.foo).toBe('bar');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseOpenClawJson('not json')).toThrow();
  });

  it('throws on JSON array', () => {
    expect(() => parseOpenClawJson('[1,2,3]')).toThrow('Invalid JSON: expected an object');
  });

  it('treats empty string name as missing', () => {
    const json = JSON.stringify({ name: '', description: 'desc' });
    expect(() => parseOpenClawJson(json)).toThrow('Missing required fields: name');
  });
});


describe('parseSkillManifest', () => {
  it('routes .yaml files to YAML parser', () => {
    const result = parseSkillManifest('skill.yaml', validYaml);
    expect(result.name).toBe('my-skill');
    expect(result.description).toBe('A test skill');
    expect(result.runtime).toBe('python');
  });

  it('routes .yml files to YAML parser', () => {
    const result = parseSkillManifest('config.yml', validYaml);
    expect(result.name).toBe('my-skill');
    expect(result.description).toBe('A test skill');
  });

  it('routes .json files to JSON parser', () => {
    const result = parseSkillManifest('manifest.json', validJson);
    expect(result.name).toBe('my-skill');
    expect(result.description).toBe('A test skill');
    expect(result.runtime).toBe('python');
  });

  it('handles file paths with directories', () => {
    const result = parseSkillManifest('/tmp/skills/my-skill/manifest.yaml', validYaml);
    expect(result.name).toBe('my-skill');
  });

  it('is case-insensitive for extensions', () => {
    const result = parseSkillManifest('skill.YAML', validYaml);
    expect(result.name).toBe('my-skill');
  });

  it('throws for unsupported extensions', () => {
    expect(() => parseSkillManifest('config.toml', 'name = "test"')).toThrow(
      'Unsupported manifest file extension: .toml'
    );
  });

  it('throws for files with no extension', () => {
    expect(() => parseSkillManifest('Makefile', '')).toThrow(
      'Unsupported manifest file extension: '
    );
  });

  it('propagates YAML parse errors', () => {
    expect(() => parseSkillManifest('bad.yaml', 'version: "1.0"')).toThrow(
      'Missing required fields: name, description'
    );
  });

  it('propagates JSON parse errors', () => {
    const json = JSON.stringify({ version: '1.0' });
    expect(() => parseSkillManifest('bad.json', json)).toThrow(
      'Missing required fields: name, description'
    );
  });
});
