'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

interface Peer {
  id: string;
  endpoint: string;
  fingerprint: string;
  display_name: string | null;
  peer_type: string;
  federation_scope: string;
  active: boolean;
  suspended: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
  is_default_supernode: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
  messages_received: number;
  messages_quarantined: number;
  created_at: string;
}

export default function PeersPage() {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(true);
  const [addEndpoint, setAddEndpoint] = useState('');
  const [addError, setAddError] = useState('');

  useEffect(() => {
    loadPeers();
  }, []);

  async function loadPeers() {
    const supabase = createSupabaseBrowser();
    const { data } = await supabase
      .from('gossip_peers')
      .select('*')
      .order('created_at');
    setPeers((data as Peer[]) ?? []);
    setLoading(false);
  }

  async function addPeer(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    const res = await fetch('/api/v2/gossip/peers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: addEndpoint, fingerprint: 'pending' }),
    });
    if (res.ok) {
      setAddEndpoint('');
      loadPeers();
    } else {
      const err = await res.json();
      setAddError(err.error ?? 'Failed to add peer');
    }
  }

  async function suspendPeer(id: string) {
    const supabase = createSupabaseBrowser();
    await supabase
      .from('gossip_peers')
      .update({ active: false, suspended: true, suspended_at: new Date().toISOString(), suspended_reason: 'Manual suspension by admin' })
      .eq('id', id);
    loadPeers();
  }

  async function resumePeer(id: string) {
    const supabase = createSupabaseBrowser();
    await supabase
      .from('gossip_peers')
      .update({ active: true, suspended: false, suspended_at: null, suspended_reason: null })
      .eq('id', id);
    loadPeers();
  }

  async function removePeer(id: string) {
    if (!confirm('Remove this peer? This cannot be undone.')) return;
    const supabase = createSupabaseBrowser();
    await supabase.from('gossip_peers').delete().eq('id', id);
    loadPeers();
  }

  if (loading) return <div style={{ padding: 40, fontFamily: 'system-ui' }}>Loading...</div>;

  return (
    <div style={{ padding: 40, fontFamily: 'system-ui', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Link href="/dashboard/gossip" style={{ color: '#666', textDecoration: 'none' }}>Gossip</Link>
        <span style={{ color: '#ccc' }}>/</span>
        <h1 style={{ margin: 0 }}>Peers</h1>
      </div>

      {/* Add peer form */}
      <form onSubmit={addPeer} style={{ marginBottom: 32, display: 'flex', gap: 8 }}>
        <input
          type="url"
          placeholder="https://remote-instance.example.com"
          value={addEndpoint}
          onChange={e => setAddEndpoint(e.target.value)}
          required
          style={{ flex: 1, padding: '8px 12px', borderRadius: 4, border: '1px solid #ccc', fontFamily: 'system-ui' }}
        />
        <button type="submit" style={{ padding: '8px 16px', borderRadius: 4, border: 'none', background: '#2563eb', color: 'white', cursor: 'pointer' }}>
          Add Peer
        </button>
      </form>
      {addError && <p style={{ color: '#dc2626', marginTop: -20, marginBottom: 16 }}>{addError}</p>}

      {/* Peer list */}
      {peers.length === 0 ? (
        <p style={{ color: '#999' }}>No peers configured.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {peers.map(p => (
            <div key={p.id} style={{
              padding: 16, borderRadius: 8, border: '1px solid #e5e5e5',
              background: p.suspended ? '#fef2f2' : 'white',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {p.display_name ?? p.endpoint}
                    {p.is_default_supernode && <span style={{ marginLeft: 8, fontSize: 12, color: '#2563eb' }}>default supernode</span>}
                  </div>
                  <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>{p.endpoint}</div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                    <code>{p.fingerprint}</code> | {p.peer_type} | scope: {p.federation_scope}
                  </div>
                </div>
                <div style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                  background: p.suspended ? '#fecaca' : p.active ? '#dcfce7' : '#f3f4f6',
                  color: p.suspended ? '#dc2626' : p.active ? '#16a34a' : '#666',
                }}>
                  {p.suspended ? 'SUSPENDED' : p.active ? 'Active' : 'Inactive'}
                </div>
              </div>

              {/* Stats */}
              <div style={{ display: 'flex', gap: 24, marginTop: 12, fontSize: 13, color: '#666' }}>
                <span>Received: {p.messages_received}</span>
                <span style={{ color: p.messages_quarantined > 0 ? '#dc2626' : '#666' }}>
                  Quarantined: {p.messages_quarantined}
                </span>
                <span>Last sync: {p.last_sync_at ? new Date(p.last_sync_at).toLocaleString() : 'never'}</span>
                {p.last_sync_error && <span style={{ color: '#dc2626' }}>Error: {p.last_sync_error}</span>}
              </div>

              {p.suspended && p.suspended_reason && (
                <div style={{ marginTop: 8, fontSize: 13, color: '#dc2626' }}>
                  Reason: {p.suspended_reason}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {p.suspended ? (
                  <button onClick={() => resumePeer(p.id)} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #16a34a', background: 'white', color: '#16a34a', cursor: 'pointer', fontSize: 12 }}>
                    Resume
                  </button>
                ) : (
                  <button onClick={() => suspendPeer(p.id)} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #dc2626', background: 'white', color: '#dc2626', cursor: 'pointer', fontSize: 12 }}>
                    Suspend
                  </button>
                )}
                <button onClick={() => removePeer(p.id)} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #999', background: 'white', color: '#999', cursor: 'pointer', fontSize: 12 }}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
