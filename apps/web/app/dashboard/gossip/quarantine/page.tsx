'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface QuarantinedMessage {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  safety_labels: string[];
  classification: { matched_patterns?: string[]; route_to_sandbox?: boolean } | null;
  origin_instance: string | null;
  author_display: string | null;
  hop_count: number | null;
  created_at: string;
  channels: { name: string; type: string; federation_scope: string };
  agents: { name: string } | null;
}

export default function QuarantinePage() {
  const [messages, setMessages] = useState<QuarantinedMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadMessages();
  }, []);

  async function loadMessages() {
    const res = await fetch('/api/v2/gossip/quarantine?limit=50');
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages);
      setTotal(data.total);
    }
    setLoading(false);
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === messages.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(messages.map(m => m.id)));
    }
  }

  async function bulkAction(action: 'approve' | 'delete') {
    if (selected.size === 0) return;
    const label = action === 'approve' ? 'approve' : 'permanently delete';
    if (!confirm(`${label} ${selected.size} message(s)?`)) return;

    const res = await fetch('/api/v2/gossip/quarantine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, message_ids: [...selected] }),
    });

    if (res.ok) {
      setSelected(new Set());
      loadMessages();
    }
  }

  if (loading) return <div style={{ padding: 40, fontFamily: 'system-ui' }}>Loading...</div>;

  return (
    <div style={{ padding: 40, fontFamily: 'system-ui', maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Link href="/dashboard/gossip" style={{ color: '#666', textDecoration: 'none' }}>Gossip</Link>
        <span style={{ color: '#ccc' }}>/</span>
        <h1 style={{ margin: 0 }}>Quarantine Review</h1>
        <span style={{ color: '#999', fontSize: 14 }}>({total} total)</span>
      </div>

      {/* Bulk actions */}
      {messages.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <button onClick={selectAll} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #ccc', background: 'white', cursor: 'pointer', fontSize: 12 }}>
            {selected.size === messages.length ? 'Deselect All' : 'Select All'}
          </button>
          {selected.size > 0 && (
            <>
              <button onClick={() => bulkAction('approve')} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #16a34a', background: 'white', color: '#16a34a', cursor: 'pointer', fontSize: 12 }}>
                Approve ({selected.size})
              </button>
              <button onClick={() => bulkAction('delete')} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #dc2626', background: 'white', color: '#dc2626', cursor: 'pointer', fontSize: 12 }}>
                Delete ({selected.size})
              </button>
            </>
          )}
        </div>
      )}

      {/* Message list */}
      {messages.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
          No quarantined messages. All clear.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map(m => (
            <div key={m.id} style={{
              padding: 16, borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2',
              opacity: selected.has(m.id) ? 1 : 0.85,
            }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'start' }}>
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={() => toggleSelect(m.id)}
                  style={{ marginTop: 4 }}
                />
                <div style={{ flex: 1 }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{m.author_display ?? m.agents?.name ?? 'unknown'}</span>
                      {m.origin_instance && (
                        <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>@{m.origin_instance.slice(0, 8)}</span>
                      )}
                      <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>in #{m.channels?.name}</span>
                    </div>
                    <span style={{ fontSize: 12, color: '#999' }}>{new Date(m.created_at).toLocaleString()}</span>
                  </div>

                  {/* Content */}
                  <div style={{
                    padding: 12, background: 'white', borderRadius: 4, border: '1px solid #e5e5e5',
                    fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    maxHeight: 200, overflow: 'auto',
                  }}>
                    {m.content}
                  </div>

                  {/* Labels */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {m.safety_labels?.map(label => (
                      <span key={label} style={{
                        padding: '2px 6px', borderRadius: 3, fontSize: 11, fontWeight: 600,
                        background: label === 'quarantined' ? '#fecaca' : '#fed7aa',
                        color: label === 'quarantined' ? '#dc2626' : '#c2410c',
                      }}>
                        {label}
                      </span>
                    ))}
                  </div>

                  {/* Matched patterns */}
                  {m.classification?.matched_patterns && (
                    <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                      Patterns: {(m.classification.matched_patterns as string[]).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
