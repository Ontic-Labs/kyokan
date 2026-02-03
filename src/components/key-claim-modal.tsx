"use client";

import { useState, useEffect } from "react";

interface KeyClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function KeyClaimModal({ isOpen, onClose }: KeyClaimModalProps) {
  const [email, setEmail] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Check availability when modal opens
      fetch("/api/keys/claim")
        .then((r) => r.json())
        .then((data) => setAvailable(data.available))
        .catch(() => setAvailable(null));
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/keys/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message ?? "Failed to claim key");
      } else {
        setApiKey(data.key);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (apiKey) {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setEmail("");
    setApiKey(null);
    setError(null);
    setCopied(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-surface-card border border-border-default rounded-lg shadow-xl w-full max-w-md p-6">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-text-muted hover:text-text-primary"
        >
          ✕
        </button>

        <h2 className="text-xl font-bold text-text-primary mb-2">
          Get API Key
        </h2>

        {!apiKey ? (
          <>
            <p className="text-sm text-text-secondary mb-4">
              Enter your email to claim a free API key.
              {available !== null && (
                <span className="block mt-1 text-text-muted">
                  {available} keys available
                </span>
              )}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-3 py-2 bg-surface-input border border-border-default rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary"
              />

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full px-4 py-2 bg-accent-primary text-white rounded-md font-medium hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Claiming..." : "Get API Key"}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm text-text-secondary mb-4">
              Your API key is ready! Save it somewhere safe — you can retrieve
              it again using the same email.
            </p>

            <div className="relative">
              <code className="block w-full p-3 bg-surface-input border border-border-default rounded-md text-sm font-mono text-accent-primary break-all">
                {apiKey}
              </code>
              <button
                onClick={handleCopy}
                className="absolute top-2 right-2 px-2 py-1 text-xs bg-surface-nav rounded hover:bg-surface-card"
              >
                {copied ? "✓ Copied" : "Copy"}
              </button>
            </div>

            <div className="mt-4 p-3 bg-surface-input rounded-md text-xs text-text-muted">
              <strong className="text-text-secondary">Usage:</strong>
              <code className="block mt-1">
                ?api_key={apiKey.slice(0, 8)}...
              </code>
            </div>

            <button
              onClick={handleClose}
              className="w-full mt-4 px-4 py-2 bg-surface-nav border border-border-default rounded-md text-text-primary hover:bg-surface-card"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
