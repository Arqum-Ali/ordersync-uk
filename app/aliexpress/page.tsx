
'use client';

import { useState } from 'react';

export default function AliExpressDashboard() {
  const [loading, setLoading] = useState(false);

  return (
    <main className="page">
      <section className="panel">

        <div className="eyebrow">
          ACCOUNT INTEGRATION
        </div>

        <h1>AliExpress Dashboard</h1>

        <p className="intro">
          Authorize your AliExpress account and securely
          manage your API tokens.
        </p>

        <div style={{
          padding: '18px',
          border: '1px solid #ddd',
          borderRadius: '12px',
          marginBottom: '20px'
        }}>
          <strong>AliExpress Account</strong>

          <p style={{ color: '#666', fontSize: '14px' }}>
            Click below to connect or reauthorize your account.
          </p>

          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              window.location.href = '/api/aliexpress/authorize';
            }}
          >
            {loading
              ? 'Redirecting...'
              : 'Authorize AliExpress'}
          </button>
        </div>

        <div style={{
          padding: '14px',
          background: '#f5f5f5',
          borderRadius: '10px'
        }}>
          <strong>Authorization information</strong>

          <p style={{ fontSize: '13px', color: '#666' }}>
            After authorization, AliExpress redirects to your
            callback. Your backend exchanges the code for
            access and refresh tokens.
          </p>
        </div>

        <p style={{
          marginTop: '25px',
          fontSize: '13px',
          color: '#888'
        }}>
          Your existing eBay Order Updater remains unchanged.
        </p>

      </section>
    </main>
  );
}
