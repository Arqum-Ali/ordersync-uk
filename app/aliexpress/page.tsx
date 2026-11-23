
'use client';

import { useEffect, useState } from 'react';

type AliExpressAccount = {
  account_label: string;
  aliexpress_user_id: string;
  connection_status: string;
  access_token_expires_at: string;
  updated_at: string;
};

export default function AliExpressDashboard() {
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<AliExpressAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadAccounts() {
      try {
        const response = await fetch('/api/aliexpress/accounts', {
          cache: 'no-store',
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.message || 'Could not load accounts');
        }

        setAccounts(data.accounts);

        if (data.accounts.length > 0) {
          setSelectedAccount(data.accounts[0].aliexpress_user_id);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Something went wrong'
        );
      } finally {
        setFetching(false);
      }
    }

    loadAccounts();
  }, []);

  const selected = accounts.find(
    account => account.aliexpress_user_id === selectedAccount
  );

  return (
    <main className="page">
      <section className="panel">

        <div className="eyebrow">ACCOUNT INTEGRATION</div>

        <h1>AliExpress Dashboard</h1>

        <p className="intro">
          Connect, view and select your AliExpress accounts.
        </p>

        <div style={{
          padding: '18px',
          border: '1px solid #ddd',
          borderRadius: '12px',
          marginBottom: '20px'
        }}>
          <strong>Connect another account</strong>

          <p style={{ color: '#666', fontSize: '14px' }}>
            Authorize an AliExpress account to add it to your dashboard.
          </p>

          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              window.location.href = '/api/aliexpress/authorize';
            }}
          >
            {loading ? 'Redirecting...' : 'Authorize AliExpress'}
          </button>
        </div>

        <div style={{
          padding: '18px',
          border: '1px solid #ddd',
          borderRadius: '12px',
          marginBottom: '20px'
        }}>
          <strong>Connected AliExpress Accounts</strong>

          {fetching && <p>Loading accounts...</p>}

          {error && (
            <p style={{ color: 'red' }}>{error}</p>
          )}

          {!fetching && !error && accounts.length === 0 && (
            <p>No connected accounts found.</p>
          )}

          {accounts.map(account => (
            <label
              key={account.aliexpress_user_id}
              style={{
                display: 'block',
                padding: '14px',
                marginTop: '12px',
                border: selectedAccount === account.aliexpress_user_id
                  ? '2px solid #2563eb'
                  : '1px solid #ddd',
                borderRadius: '10px',
                cursor: 'pointer'
              }}
            >
              <input
                type="radio"
                name="aliexpressAccount"
                value={account.aliexpress_user_id}
                checked={selectedAccount === account.aliexpress_user_id}
                onChange={() =>
                  setSelectedAccount(account.aliexpress_user_id)
                }
                style={{ marginRight: '10px' }}
              />

              <strong>{account.account_label}</strong>

              <p style={{ fontSize: '13px', color: '#666', margin: '8px 0 0 26px' }}>
                User ID: {account.aliexpress_user_id}
              </p>

              <p style={{ fontSize: '13px', color: '#16803c', margin: '5px 0 0 26px' }}>
                Status: {account.connection_status}
              </p>

              <p style={{ fontSize: '12px', color: '#777', margin: '5px 0 0 26px' }}>
                Token expiry: {new Date(account.access_token_expires_at).toLocaleString()}
              </p>
            </label>
          ))}

          {selected && (
            <div style={{
              marginTop: '18px',
              padding: '12px',
              background: '#f0f7ff',
              borderRadius: '8px'
            }}>
              <strong>Selected account</strong>
              <p style={{ fontSize: '14px', marginBottom: 0 }}>
                {selected.account_label} ({selected.aliexpress_user_id})
              </p>
            </div>
          )}
        </div>

        <p style={{ fontSize: '13px', color: '#888' }}>
          Your existing eBay Order Updater remains unchanged.
        </p>

      </section>
    </main>
  );
}
