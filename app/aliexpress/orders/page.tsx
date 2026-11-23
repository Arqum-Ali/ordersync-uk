
'use client';

import { useEffect, useState } from 'react';

type AliExpressAccount = {
  account_label: string;
  aliexpress_user_id: string;
  connection_status: string;
  access_token_expires_at: string;
};

export default function AliExpressOrdersPage() {
  const [accounts, setAccounts] = useState<AliExpressAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

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

        setAccounts(data.accounts || []);

        if (data.accounts?.length > 0) {
          setSelectedAccount(data.accounts[0].aliexpress_user_id);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Could not load accounts'
        );
      } finally {
        setLoading(false);
      }
    }

    loadAccounts();
  }, []);

  return (
    <main className="page">
      <section className="panel">
        <div className="eyebrow">ALIEXPRESS INTEGRATION</div>

        <h1>Order Management</h1>

        <p className="intro">
          Upload your Excel file and retrieve AliExpress order tracking details.
        </p>

        <div style={{
          padding: '18px',
          border: '1px solid #ddd',
          borderRadius: '12px',
          marginBottom: '20px'
        }}>
          <strong>1. Select AliExpress Account</strong>

          {loading && <p>Loading accounts...</p>}

          {error && <p style={{ color: 'red' }}>{error}</p>}

          {!loading && !error && accounts.length === 0 && (
            <p>No connected accounts. Please authorize an account first.</p>
          )}

          {accounts.map(account => (
            <label
              key={account.aliexpress_user_id}
              style={{
                display: 'block',
                padding: '12px',
                marginTop: '10px',
                border: selectedAccount === account.aliexpress_user_id
                  ? '2px solid #2563eb'
                  : '1px solid #ddd',
                borderRadius: '8px',
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

              <p style={{ fontSize: '13px', color: '#16803c', margin: '5px 0 0 25px' }}>
                Status: {account.connection_status}
              </p>
            </label>
          ))}
        </div>

        <div style={{
          padding: '18px',
          border: '1px solid #ddd',
          borderRadius: '12px',
          marginBottom: '20px'
        }}>
          <strong>2. Upload Excel File</strong>

          <p style={{ color: '#666', fontSize: '14px' }}>
            Select the Excel file containing your AliExpress order IDs.
          </p>

          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={event =>
              setFile(event.target.files?.[0] || null)
            }
          />

          {file && (
            <p style={{ fontSize: '13px', color: '#16803c' }}>
              Selected file: {file.name}
            </p>
          )}
        </div>

        <div style={{
          padding: '18px',
          border: '1px solid #ddd',
          borderRadius: '12px',
          marginBottom: '20px'
        }}>
          <strong>3. Select Date Range</strong>

          <div style={{ marginTop: '14px' }}>
            <label>Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={event => setStartDate(event.target.value)}
              style={{ display: 'block', marginTop: '6px', padding: '8px' }}
            />
          </div>

          <div style={{ marginTop: '14px' }}>
            <label>End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={event => setEndDate(event.target.value)}
              style={{ display: 'block', marginTop: '6px', padding: '8px' }}
            />
          </div>
        </div>

        <button
          type="button"
          disabled={
            !selectedAccount ||
            !file ||
            !startDate ||
            !endDate ||
            startDate > endDate
          }
          style={{
            padding: '12px 20px',
            cursor: 'pointer'
          }}
        >
          Retrieve Orders
        </button>

        <div style={{
          marginTop: '25px',
          padding: '18px',
          border: '1px solid #ddd',
          borderRadius: '12px'
        }}>
          <strong>4. Order Results</strong>

          <p style={{ color: '#777', fontSize: '14px' }}>
            Your order tracking results will appear here after retrieval is implemented.
          </p>
        </div>
      </section>
    </main>
  );
}

