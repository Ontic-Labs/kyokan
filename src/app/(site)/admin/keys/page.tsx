'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './page.module.css';

interface ApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  request_count: number;
}

interface NewKeyResponse {
  id: string;
  key: string;
  name: string;
  expires_at: string | null;
}

export default function AdminKeysPage() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminSecret, setAdminSecret] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // New key form
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiresDays, setNewKeyExpiresDays] = useState<number | ''>('');
  const [createdKey, setCreatedKey] = useState<NewKeyResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/keys', {
        headers: { 'X-Admin-Secret': adminSecret },
      });
      if (!res.ok) {
        if (res.status === 401) {
          setIsAuthenticated(false);
          throw new Error('Invalid admin secret');
        }
        throw new Error('Failed to fetch keys');
      }
      const data = await res.json();
      setKeys(data.keys);
      setIsAuthenticated(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [adminSecret]);

  useEffect(() => {
    if (adminSecret) {
      fetchKeys();
    }
  }, [adminSecret, fetchKeys]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    fetchKeys();
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);

    try {
      const body: { name: string; expires_in_days?: number } = { name: newKeyName };
      if (newKeyExpiresDays) {
        body.expires_in_days = newKeyExpiresDays;
      }

      const res = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': adminSecret,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create key');
      }

      const data: NewKeyResponse = await res.json();
      setCreatedKey(data);
      setNewKeyName('');
      setNewKeyExpiresDays('');
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeKey = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to revoke key "${name}"? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/keys/${id}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Secret': adminSecret },
      });

      if (!res.ok) {
        throw new Error('Failed to revoke key');
      }

      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const formatDate = (date: string | null) => {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getKeyStatus = (key: ApiKeyInfo) => {
    if (key.revoked_at) return { label: 'Revoked', className: styles.statusRevoked };
    if (key.expires_at && new Date(key.expires_at) < new Date()) {
      return { label: 'Expired', className: styles.statusExpired };
    }
    return { label: 'Active', className: styles.statusActive };
  };

  if (!isAuthenticated && !loading) {
    return (
      <div className={styles.container}>
        <h1>Admin: API Keys</h1>
        <form onSubmit={handleLogin} className={styles.loginForm}>
          <label htmlFor="adminSecret">Admin Secret</label>
          <input
            id="adminSecret"
            type="password"
            value={adminSecret}
            onChange={(e) => setAdminSecret(e.target.value)}
            placeholder="Enter ADMIN_SECRET"
            autoComplete="off"
          />
          <button type="submit" disabled={!adminSecret}>
            Authenticate
          </button>
          {error && <p className={styles.error}>{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1>Admin: API Keys</h1>

      {/* New Key Created Modal */}
      {createdKey && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h2>🔑 Key Created</h2>
            <p className={styles.warning}>
              Copy this key now — it will not be shown again!
            </p>
            <div className={styles.keyDisplay}>
              <code>{createdKey.key}</code>
              <button
                className={copied ? styles.copiedButton : undefined}
                onClick={() => copyToClipboard(createdKey.key)}
              >
                {copied ? '✓ Copied!' : 'Copy'}
              </button>
            </div>
            <p><strong>Name:</strong> {createdKey.name}</p>
            <p><strong>Expires:</strong> {formatDate(createdKey.expires_at)}</p>
            <button
              className={styles.closeButton}
              onClick={() => setCreatedKey(null)}
            >
              I&apos;ve saved the key
            </button>
          </div>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {/* Create Key Form */}
      <section className={styles.section}>
        <h2>Create New Key</h2>
        <form onSubmit={handleCreateKey} className={styles.createForm}>
          <div className={styles.formRow}>
            <label htmlFor="keyName">Name</label>
            <input
              id="keyName"
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g., Mobile App Production"
              required
            />
          </div>
          <div className={styles.formRow}>
            <label htmlFor="expiresDays">Expires in (days)</label>
            <input
              id="expiresDays"
              type="number"
              min="1"
              value={newKeyExpiresDays}
              onChange={(e) => setNewKeyExpiresDays(e.target.value ? parseInt(e.target.value) : '')}
              placeholder="Leave empty for no expiration"
            />
          </div>
          <button type="submit" disabled={creating || !newKeyName}>
            {creating ? 'Creating...' : 'Create Key'}
          </button>
        </form>
      </section>

      {/* Keys List */}
      <section className={styles.section}>
        <h2>API Keys</h2>
        {loading ? (
          <p>Loading...</p>
        ) : keys.length === 0 ? (
          <p>No API keys yet. Create one above.</p>
        ) : (
          <table className={styles.keysTable}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Status</th>
                <th>Created</th>
                <th>Expires</th>
                <th>Last Used</th>
                <th>Requests</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const status = getKeyStatus(key);
                return (
                  <tr key={key.id} className={key.revoked_at ? styles.revokedRow : ''}>
                    <td>{key.name}</td>
                    <td><code>{key.key_prefix}...</code></td>
                    <td><span className={status.className}>{status.label}</span></td>
                    <td>{formatDate(key.created_at)}</td>
                    <td>{formatDate(key.expires_at)}</td>
                    <td>{formatDate(key.last_used_at)}</td>
                    <td>{key.request_count.toLocaleString()}</td>
                    <td>
                      {!key.revoked_at && (
                        <button
                          className={styles.revokeButton}
                          onClick={() => handleRevokeKey(key.id, key.name)}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
