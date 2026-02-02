'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './page.module.css';
import { UI_STRINGS } from '@/constants/ui-strings';

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
          throw new Error(UI_STRINGS.adminKeys.errors.invalidAdminSecret);
        }
        throw new Error(UI_STRINGS.adminKeys.errors.failedFetch);
      }
      const data = await res.json();
      setKeys(data.keys);
      setIsAuthenticated(true);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : UI_STRINGS.adminKeys.errors.unknown
      );
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
        throw new Error(data.error || UI_STRINGS.adminKeys.errors.failedCreate);
      }

      const data: NewKeyResponse = await res.json();
      setCreatedKey(data);
      setNewKeyName('');
      setNewKeyExpiresDays('');
      fetchKeys();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : UI_STRINGS.adminKeys.errors.unknown
      );
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeKey = async (id: string, name: string) => {
    if (!confirm(UI_STRINGS.adminKeys.confirmRevoke(name))) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/keys/${id}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Secret': adminSecret },
      });

      if (!res.ok) {
        throw new Error(UI_STRINGS.adminKeys.errors.failedRevoke);
      }

      fetchKeys();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : UI_STRINGS.adminKeys.errors.unknown
      );
    }
  };

  const formatDate = (date: string | null) => {
    if (!date) return UI_STRINGS.adminKeys.noDate;
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getKeyStatus = (key: ApiKeyInfo) => {
    if (key.revoked_at) {
      return { label: UI_STRINGS.adminKeys.status.revoked, className: styles.statusRevoked };
    }
    if (key.expires_at && new Date(key.expires_at) < new Date()) {
      return { label: UI_STRINGS.adminKeys.status.expired, className: styles.statusExpired };
    }
    return { label: UI_STRINGS.adminKeys.status.active, className: styles.statusActive };
  };

  if (!isAuthenticated && !loading) {
    return (
      <div className={styles.container}>
        <h1>{UI_STRINGS.adminKeys.title}</h1>
        <form onSubmit={handleLogin} className={styles.loginForm}>
          <label htmlFor="adminSecret">{UI_STRINGS.adminKeys.login.label}</label>
          <input
            id="adminSecret"
            type="password"
            value={adminSecret}
            onChange={(e) => setAdminSecret(e.target.value)}
            placeholder={UI_STRINGS.adminKeys.login.placeholder}
            autoComplete="off"
          />
          <button type="submit" disabled={!adminSecret}>
            {UI_STRINGS.adminKeys.login.button}
          </button>
          {error && <p className={styles.error}>{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1>{UI_STRINGS.adminKeys.title}</h1>

      {/* New Key Created Modal */}
      {createdKey && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h2>{UI_STRINGS.adminKeys.modal.title}</h2>
            <p className={styles.warning}>
              {UI_STRINGS.adminKeys.modal.warning}
            </p>
            <div className={styles.keyDisplay}>
              <code>{createdKey.key}</code>
              <button
                className={copied ? styles.copiedButton : undefined}
                onClick={() => copyToClipboard(createdKey.key)}
              >
                {copied ? UI_STRINGS.adminKeys.modal.copied : UI_STRINGS.adminKeys.modal.copy}
              </button>
            </div>
            <p>
              <strong>{UI_STRINGS.adminKeys.modal.nameLabel}</strong> {createdKey.name}
            </p>
            <p>
              <strong>{UI_STRINGS.adminKeys.modal.expiresLabel}</strong> {formatDate(createdKey.expires_at)}
            </p>
            <button
              className={styles.closeButton}
              onClick={() => setCreatedKey(null)}
            >
              {UI_STRINGS.adminKeys.modal.saved}
            </button>
          </div>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {/* Create Key Form */}
      <section className={styles.section}>
        <h2>{UI_STRINGS.adminKeys.create.title}</h2>
        <form onSubmit={handleCreateKey} className={styles.createForm}>
          <div className={styles.formRow}>
            <label htmlFor="keyName">{UI_STRINGS.adminKeys.create.nameLabel}</label>
            <input
              id="keyName"
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder={UI_STRINGS.adminKeys.create.namePlaceholder}
              required
            />
          </div>
          <div className={styles.formRow}>
            <label htmlFor="expiresDays">{UI_STRINGS.adminKeys.create.expiresLabel}</label>
            <input
              id="expiresDays"
              type="number"
              min="1"
              value={newKeyExpiresDays}
              onChange={(e) => setNewKeyExpiresDays(e.target.value ? parseInt(e.target.value) : '')}
              placeholder={UI_STRINGS.adminKeys.create.expiresPlaceholder}
            />
          </div>
          <button type="submit" disabled={creating || !newKeyName}>
            {creating ? UI_STRINGS.adminKeys.create.submitting : UI_STRINGS.adminKeys.create.submit}
          </button>
        </form>
      </section>

      {/* Keys List */}
      <section className={styles.section}>
        <h2>{UI_STRINGS.adminKeys.list.title}</h2>
        {loading ? (
          <p>{UI_STRINGS.adminKeys.list.loading}</p>
        ) : keys.length === 0 ? (
          <p>{UI_STRINGS.adminKeys.list.empty}</p>
        ) : (
          <table className={styles.keysTable}>
            <thead>
              <tr>
                <th>{UI_STRINGS.adminKeys.list.headers.name}</th>
                <th>{UI_STRINGS.adminKeys.list.headers.prefix}</th>
                <th>{UI_STRINGS.adminKeys.list.headers.status}</th>
                <th>{UI_STRINGS.adminKeys.list.headers.created}</th>
                <th>{UI_STRINGS.adminKeys.list.headers.expires}</th>
                <th>{UI_STRINGS.adminKeys.list.headers.lastUsed}</th>
                <th>{UI_STRINGS.adminKeys.list.headers.requests}</th>
                <th>{UI_STRINGS.adminKeys.list.headers.actions}</th>
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
                          {UI_STRINGS.adminKeys.list.revoke}
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
