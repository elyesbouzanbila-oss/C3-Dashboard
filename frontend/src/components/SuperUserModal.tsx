import { useState, useCallback } from 'react'
import { Icon } from './Icon'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

interface SuperUserModalProps {
  /** Called with the session token if authentication succeeds */
  onAuthenticated: (token: string) => void
  /** Called when the user dismisses the modal */
  onCancel: () => void
}

export function SuperUserModal({ onAuthenticated, onCancel }: SuperUserModalProps) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/config/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (data.authenticated) {
        // No-password mode returns authenticated without a token.
        onAuthenticated(data.token || '')
      } else {
        setError(data.message || 'Invalid password')
      }
    } catch {
      setError('Failed to connect to backend')
    } finally {
      setLoading(false)
    }
  }, [password, onAuthenticated])

  return (
    <div className="su-modal-overlay" onClick={onCancel}>
      <div className="su-modal" onClick={e => e.stopPropagation()}>
        <div className="su-modal-header">
          <div className="su-modal-icon">
            <Icon name="lock" size={24} />
          </div>
          <h3>Super User Required</h3>
          <p className="su-modal-sub">This operation requires elevated privileges. Enter the super user password to continue.</p>
        </div>

        <form onSubmit={handleSubmit} className="su-modal-body">
          <div className="su-input-group">
            <label className="su-input-label">Super User Password</label>
            <input
              type="password"
              className="su-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password..."
              autoFocus
              disabled={loading}
            />
          </div>

          {error && <div className="su-error">{error}</div>}

          <div className="su-actions">
            <button type="button" className="refresh-btn" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
            <button
              type="submit"
              className="refresh-btn su-submit-btn"
              disabled={loading || !password.trim()}
            >
              {loading ? (
                <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Verifying...</>
              ) : (
                <><Icon name="unlock" size={14} /> Authenticate</>
              )}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .su-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.65);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          animation: suFadeIn 0.15s ease;
        }
        @keyframes suFadeIn { from { opacity: 0; } to { opacity: 1; } }
        .su-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          width: 90%;
          max-width: 400px;
          box-shadow: 0 24px 64px rgba(0,0,0,0.5);
          animation: suSlideUp 0.2s ease;
          overflow: hidden;
        }
        @keyframes suSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .su-modal-header {
          padding: 28px 24px 0;
          text-align: center;
        }
        .su-modal-icon {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: var(--warning-light);
          color: var(--warning);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 14px;
        }
        .su-modal-icon svg { width: 24px; height: 24px; }
        .su-modal-header h3 {
          font-size: 17px;
          font-weight: 700;
          color: var(--text);
          margin: 0 0 6px;
        }
        .su-modal-sub {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
          line-height: 1.5;
        }
        .su-modal-body {
          padding: 20px 24px 24px;
        }
        .su-input-group {
          margin-bottom: 12px;
        }
        .su-input-label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.4px;
          margin-bottom: 6px;
        }
        .su-input {
          width: 100%;
          padding: 10px 14px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          color: var(--text);
          font-size: 14px;
          font-family: inherit;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .su-input:focus {
          outline: none;
          border-color: var(--warning);
          box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.3);
        }
        .su-error {
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.3);
          border-radius: var(--radius);
          padding: 10px 14px;
          font-size: 13px;
          color: var(--danger);
          margin-bottom: 12px;
        }
        .su-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding-top: 8px;
        }
        .su-submit-btn {
          background: var(--warning) !important;
          color: #000 !important;
          border-color: var(--warning) !important;
          font-weight: 600;
        }
        .su-submit-btn:hover {
          background: #d97706 !important;
          border-color: #d97706 !important;
        }
        .su-submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  )
}
