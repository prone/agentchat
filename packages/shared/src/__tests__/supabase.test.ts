import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @supabase/supabase-js before importing
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((_url: string, _key: string, options?: any) => ({
    _url,
    _key,
    _options: options,
  })),
}));

import { createAgentClient, createAdminClient } from '../supabase.js';
import { createClient } from '@supabase/supabase-js';

const mockedCreateClient = vi.mocked(createClient);

describe('createAgentClient', () => {
  beforeEach(() => {
    mockedCreateClient.mockClear();
  });

  it('passes correct headers including api key', () => {
    createAgentClient('https://supabase.example.com', 'anon-key', 'agent-api-key');

    expect(mockedCreateClient).toHaveBeenCalledWith(
      'https://supabase.example.com',
      'anon-key',
      {
        global: {
          headers: {
            'x-agent-api-key': 'agent-api-key',
          },
        },
      },
    );
  });

  it('includes agent name header when provided', () => {
    createAgentClient('https://supabase.example.com', 'anon-key', 'agent-api-key', 'my-agent');

    expect(mockedCreateClient).toHaveBeenCalledWith(
      'https://supabase.example.com',
      'anon-key',
      {
        global: {
          headers: {
            'x-agent-api-key': 'agent-api-key',
            'x-agent-name': 'my-agent',
          },
        },
      },
    );
  });

  it('omits agent name header when not provided', () => {
    createAgentClient('https://supabase.example.com', 'anon-key', 'agent-api-key');

    const callArgs = mockedCreateClient.mock.calls[0];
    const options = callArgs[2] as any;
    expect(options.global.headers).not.toHaveProperty('x-agent-name');
  });
});

describe('createAdminClient', () => {
  beforeEach(() => {
    mockedCreateClient.mockClear();
  });

  it('sets persistSession to false', () => {
    createAdminClient('https://supabase.example.com', 'service-role-key');

    expect(mockedCreateClient).toHaveBeenCalledWith(
      'https://supabase.example.com',
      'service-role-key',
      {
        auth: { persistSession: false },
      },
    );
  });

  it('passes the service role key as the second argument', () => {
    createAdminClient('https://supabase.example.com', 'my-service-key');

    const callArgs = mockedCreateClient.mock.calls[0];
    expect(callArgs[1]).toBe('my-service-key');
  });
});
