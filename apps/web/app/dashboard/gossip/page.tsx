'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

interface GossipConfig {
  fingerprint: string;
  display_name: string | null;
  gossip_enabled: boolean;
}

interface PeerStats {
  total: number;
  active: number;
  supernodes: number;
  suspended: number;
}

export default function GossipOverviewPage() {
  const [config, setConfig] = useState<GossipConfig | null>(null);
  const [peerStats, setPeerStats] = useState<PeerStats | null>(null);
  const [quarantineCount, setQuarantineCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createSupabaseBrowser();

      // Instance config
      const { data: cfg } = await supabase
        .from('gossip_instance_config')
        .select('fingerprint, display_name, gossip_enabled')
        .limit(1)
        .single();
      setConfig(cfg as GossipConfig | null);

      // Peer stats
      const { data: peers } = await supabase
        .from('gossip_peers')
        .select('id, active, suspended, peer_type');
      if (peers) {
        setPeerStats({
          total: peers.length,
          active: peers.filter(p => p.active && !p.suspended).length,
          supernodes: peers.filter(p => p.peer_type === 'supernode').length,
          suspended: peers.filter(p => p.suspended).length,
        });
      }

      // Quarantine count (24h)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('quarantined', true)
        .gt('created_at', oneDayAgo);
      setQuarantineCount(count ?? 0);

      setLoading(false);
    }
    load();
  }, []);

  async function toggleGossip() {
    const action = config?.gossip_enabled ? 'disable' : 'enable';
    const res = await fetch('/api/v2/gossip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      setConfig(prev => prev ? { ...prev, gossip_enabled: !prev.gossip_enabled } : null);
    }
  }

  if (loading) return <div style={{ padding: 40, fontFamily: 'system-ui' }}>Loading...</div>;

  return (
    <div style={{ padding: 40, fontFamily: 'system-ui', maxWidth: 800 }}>
      <h1 style={{ marginBottom: 8 }}>Gossip Layer</h1>
      <p style={{ color: '#666', marginBottom: 32 }}>Federated channel management and safety monitoring</p>

      {/* Instance Identity */}
      <section style={{ marginBottom: 32, padding: 20, background: '#f8f8f8', borderRadius: 8 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Instance Identity</h2>
        {config ? (
          <>
            <div><strong>Fingerprint:</strong> <code>{config.fingerprint}</code></div>
            {config.display_name && <div><strong>Display name:</strong> {config.display_name}</div>}
            <div style={{ marginTop: 12 }}>
              <strong>Gossip:</strong>{' '}
              <span style={{ color: config.gossip_enabled ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                {config.gossip_enabled ? 'Enabled' : 'Disabled'}
              </span>
              <button
                onClick={toggleGossip}
                style={{
                  marginLeft: 12, padding: '4px 12px', borderRadius: 4, border: '1px solid #ccc',
                  cursor: 'pointer', background: 'white',
                }}
              >
                {config.gossip_enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          </>
        ) : (
          <p style={{ color: '#999' }}>Instance identity not configured. Run setup first.</p>
        )}
      </section>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 32 }}>
        <Link href="/dashboard/gossip/peers" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ padding: 20, background: '#f0f9ff', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 32, fontWeight: 700 }}>{peerStats?.total ?? 0}</div>
            <div style={{ color: '#666' }}>Peers</div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
              {peerStats?.active ?? 0} active, {peerStats?.supernodes ?? 0} supernodes
            </div>
          </div>
        </Link>

        <Link href="/dashboard/gossip/quarantine" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{
            padding: 20, borderRadius: 8, textAlign: 'center',
            background: quarantineCount > 0 ? '#fef2f2' : '#f0fdf4',
          }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: quarantineCount > 0 ? '#dc2626' : '#16a34a' }}>
              {quarantineCount}
            </div>
            <div style={{ color: '#666' }}>Quarantined (24h)</div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>Click to review</div>
          </div>
        </Link>

        <div style={{ padding: 20, background: '#f8f8f8', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: peerStats?.suspended ? '#dc2626' : '#16a34a' }}>
            {peerStats?.suspended ?? 0}
          </div>
          <div style={{ color: '#666' }}>Suspended Peers</div>
        </div>
      </div>
    </div>
  );
}
