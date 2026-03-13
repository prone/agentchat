import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sanitizeError, deriveAgentName } from '../utils.js';

describe('sanitizeError', () => {
  it('returns "Unknown error" for null input', () => {
    expect(sanitizeError(null)).toBe('Unknown error');
  });

  it('returns "Unknown error" for undefined input', () => {
    expect(sanitizeError(undefined)).toBe('Unknown error');
  });

  it('returns "Unknown error" for object without message', () => {
    expect(sanitizeError({})).toBe('Unknown error');
  });

  it('passes through normal error messages', () => {
    expect(sanitizeError(new Error('Something went wrong'))).toBe('Something went wrong');
  });

  it('sanitizes messages containing "violates"', () => {
    const err = new Error('insert or update on table "messages" violates foreign key constraint');
    expect(sanitizeError(err)).toBe('Operation failed due to a data constraint. Check your input and try again.');
  });

  it('sanitizes messages containing "constraint"', () => {
    const err = new Error('unique constraint "agents_name_key" violated');
    expect(sanitizeError(err)).toBe('Operation failed due to a data constraint. Check your input and try again.');
  });

  it('sanitizes messages containing "relation"', () => {
    const err = new Error('relation "messages" does not exist');
    expect(sanitizeError(err)).toBe('Operation failed due to a data constraint. Check your input and try again.');
  });

  it('handles error-like objects with message property', () => {
    expect(sanitizeError({ message: 'custom error' })).toBe('custom error');
  });
});

describe('deriveAgentName', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AGENTCHAT_PROJECT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('combines machine name and cwd directory name', () => {
    // cwd().split('/').pop() will give us the current directory name
    const cwd = process.cwd().split('/').pop() || 'unknown';
    const result = deriveAgentName('myserver');
    expect(result).toBe(`myserver-${cwd}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100));
  });

  it('lowercases the result', () => {
    process.env.AGENTCHAT_PROJECT = 'MyProject';
    const result = deriveAgentName('MyServer');
    expect(result).toBe('myserver-myproject');
  });

  it('replaces special characters with hyphens', () => {
    process.env.AGENTCHAT_PROJECT = 'my_project@v2';
    const result = deriveAgentName('server');
    expect(result).toBe('server-my-project-v2');
  });

  it('collapses multiple hyphens', () => {
    process.env.AGENTCHAT_PROJECT = 'my---project';
    const result = deriveAgentName('server');
    expect(result).toBe('server-my-project');
  });

  it('strips leading and trailing hyphens', () => {
    process.env.AGENTCHAT_PROJECT = '-project-';
    const result = deriveAgentName('server');
    expect(result).toBe('server-project');
  });

  it('truncates to 100 characters', () => {
    process.env.AGENTCHAT_PROJECT = 'a'.repeat(200);
    const result = deriveAgentName('server');
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('uses AGENTCHAT_PROJECT env var when set', () => {
    process.env.AGENTCHAT_PROJECT = 'custom-project';
    const result = deriveAgentName('myserver');
    expect(result).toBe('myserver-custom-project');
  });

  it('falls back to cwd directory when AGENTCHAT_PROJECT is empty string', () => {
    // Empty string is falsy, so it falls through to process.cwd().split('/').pop()
    process.env.AGENTCHAT_PROJECT = '';
    const cwd = process.cwd().split('/').pop() || 'unknown';
    const result = deriveAgentName('server');
    const expected = `server-${cwd}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
    expect(result).toBe(expected);
  });
});
