
'use client';

import { useState } from 'react';

export default function AliExpressDashboard() {
  const [loading, setLoading] = useState(false);

  return (
    <main className="page">
      <section className="panel">
        <div className="eyebrow">ACCOUNT INTEGRATION</div>

        <h1>AliExpress Accounts</h1>

        <p className="intro">
          Connect and authorize your AliExpress accounts.
        </p>

        <div
          style={{
            padding: '18px',
            border: '1px solid #ddd',
            borderRadius: '12px',
            marginBottom: '20px',
          }}
        >
          <strong>Connect another account</strong>

          <p style={{ color: '#666', fontSize: '14px' }}>
            Click below to authorize an AliExpress account.
            Your connected accounts will be saved securely.
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

        <p style={{ fontSize: '13px', color: '#888' }}>
          Account selection and order tracking will be available
          on the separate Order Management page.
        </p>

        <p style={{ fontSize: '13px', color: '#888' }}>
          Your existing eBay Order Updater remains unchanged.
        </p>
      </section>
    </main>
  );
}
