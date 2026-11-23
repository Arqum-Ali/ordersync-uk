
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './orders.module.css';

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

  const canContinue =
    selectedAccount &&
    file &&
    startDate &&
    endDate &&
    startDate <= endDate;

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>ALIEXPRESS INTEGRATION</div>

        <h1>Order Management</h1>

        <p className={styles.intro}>
          Select your account, choose a date range and upload your Excel file.
        </p>

        <div className={styles.section}>
          <strong className={styles.sectionTitle}>
            1. Select AliExpress Account
          </strong>

          {loading && <p>Loading accounts...</p>}

          {error && <p style={{ color: 'red' }}>{error}</p>}

          {!loading && !error && accounts.length === 0 && (
            <p>No connected accounts. Please authorize an account first.</p>
          )}

          {accounts.map(account => (
            <label
              key={account.aliexpress_user_id}
              className={`${styles.accountOption} ${
                selectedAccount === account.aliexpress_user_id
                  ? styles.accountSelected
                  : ''
              }`}
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

              <p className={styles.accountDetails}>
                Status: {account.connection_status}
              </p>
            </label>
          ))}
        </div>

        <div className={styles.section}>
          <strong className={styles.sectionTitle}>
            2. Select Date Range
          </strong>

          <div className={styles.dateGrid}>
            <div>
              <label className={styles.fieldLabel}>Start Date</label>
              <input
                className={styles.dateInput}
                type="date"
                value={startDate}
                onChange={event => setStartDate(event.target.value)}
              />
            </div>

            <div>
              <label className={styles.fieldLabel}>End Date</label>
              <input
                className={styles.dateInput}
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={event => setEndDate(event.target.value)}
              />
            </div>
          </div>

          <p className={styles.mutedText}>
            Only orders within this date range will be processed.
          </p>
        </div>

        <div className={styles.section}>
          <strong className={styles.sectionTitle}>
            3. Upload Excel File
          </strong>

          <label className={styles.uploadBox}>
            <span className={styles.uploadIcon}>📄</span>
            <span className={styles.uploadText}>
              Click here to select your Excel file
            </span>
            <span className={styles.uploadHint}>
              Supported formats: .xlsx and .xls
            </span>

            <input
              className={styles.fileInput}
              type="file"
              accept=".xlsx,.xls"
              onChange={event =>
                setFile(event.target.files?.[0] || null)
              }
            />
          </label>

          {file && (
            <p className={styles.selectedFile}>
              Selected file: {file.name}
            </p>
          )}
        </div>

        <Link
          href="/aliexpress/orders/results"
          className={styles.primaryButton}
          style={{
            opacity: canContinue ? 1 : 0.5,
            pointerEvents: canContinue ? 'auto' : 'none',
          }}
          aria-disabled={!canContinue}
          onClick={event => {
            if (!canContinue) event.preventDefault();
          }}
        >
          Continue to Results
        </Link>
      </section>
    </main>
  );
}
