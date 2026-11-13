
'use client';

import { useState } from 'react';

type Result = {
  ok: boolean;
  added: number;
  skipped: number;
  invalid?: number;
  tabs: string[];
  earningsMatched?: number;
  earningsNotFound?: number;
  unmatchedOrderNumbers?: string[];
  message?: string;
  error?: string;
};

const accounts = ['Betelbee', 'Tayyab', 'Sell High'];

const months = [
  'January', 'February', 'March', 'April',
  'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'
];

const shortMonths: Record<string, string> = {
  January: 'Jan',
  February: 'Feb',
  March: 'Mar',
  April: 'Apr',
  May: 'May',
  June: 'Jun',
  July: 'July',
  August: 'August',
  September: 'Sep',
  October: 'Oct',
  November: 'Nov',
  December: 'Dec'
};

export default function Home() {
  const [account, setAccount] = useState('Betelbee');
  const [month, setMonth] = useState(months[new Date().getMonth()]);

  const [file, setFile] = useState<File | null>(null);
  const [transactionFile, setTransactionFile] = useState<File | null>(null);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    setError('');
    setResult(null);

    if (!file) {
      setError('Choose the eBay Orders file first.');
      return;
    }

    if (!transactionFile) {
      setError('Choose the Transaction Report file first.');
      return;
    }

    if (!account || !month) {
      setError('Select an eBay account and month.');
      return;
    }

    setBusy(true);

    try {
      const body = new FormData();

      body.append('file', file);
      body.append('transactionFile', transactionFile);
      body.append('account', account);
      body.append('month', month);

      const res = await fetch('/api/import', {
        method: 'POST',
        body
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Import failed.');
      }

      setResult(data);

    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <section className="panel">

        <div className="eyebrow">
          SHARED GOOGLE SHEET
        </div>

        <h1>eBay Order Updater</h1>

        <p className="intro">
          Select your eBay account and order month.
          Upload your Orders file and Transaction Report
          to update the correct tab in your shared Google Sheet.
        </p>

        <form onSubmit={submit}>

          <label className="field">
            <span className="field-label">
              1. Select eBay account
            </span>

            <select
              value={account}
              onChange={e => {
                setAccount(e.target.value);
                setResult(null);
                setError('');
              }}
              required
            >
              {accounts.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">
              2. Select order month
            </span>

            <select
              value={month}
              onChange={e => {
                setMonth(e.target.value);
                setResult(null);
                setError('');
              }}
              required
            >
              {months.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <div className="destination">
            <small>ORDERS WILL BE IMPORTED INTO</small>
            <strong>
              {account} {shortMonths[month]}
            </strong>
          </div>

          <label className="filebox">
            <span className="fileicon">↑</span>

            <strong>
              {file ? file.name : '1. Choose eBay Orders file'}
            </strong>

            <small>
              {file ? 'Orders file selected' : 'Excel (.xlsx / .xls) or CSV'}
            </small>

            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={e => {
                setFile(e.target.files?.[0] || null);
                setResult(null);
                setError('');
              }}
            />
          </label>

          <label className="filebox transaction-filebox">
            <span className="fileicon">↑</span>

            <strong>
              {transactionFile
                ? transactionFile.name
                : '2. Choose Transaction Report'}
            </strong>

            <small>
              {transactionFile
                ? 'Transaction Report selected'
                : 'Excel (.xlsx / .xls) or CSV'}
            </small>

            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={e => {
                setTransactionFile(e.target.files?.[0] || null);
                setResult(null);
                setError('');
              }}
            />
          </label>

          <button disabled={busy || !file || !transactionFile}>
            {busy ? 'Updating Google Sheet…' : 'Update Orders'}
          </button>

        </form>

        {error && (
          <div className="alert error">
            {error}
          </div>
        )}

        {result && (
          <div className="alert success">
            <strong>Import completed</strong>

            <div className="stats">
              <div>
                <b>{result.added}</b>
                <span>New rows added</span>
              </div>

              <div>
                <b>{result.skipped}</b>
                <span>Duplicates skipped</span>
              </div>
            </div>

            <div className="stats">
              <div>
                <b>{result.earningsMatched ?? 0}</b>
                <span>Earnings matched</span>
              </div>

              <div>
                <b>{result.earningsNotFound ?? 0}</b>
                <span>Earnings not matched</span>
              </div>
            </div>

            <p>
              Monthly tabs updated:{' '}
              {result.tabs.join(', ') || 'None'}
            </p>

            {result.unmatchedOrderNumbers &&
              result.unmatchedOrderNumbers.length > 0 && (
                <div
                  style={{
                    marginTop: '18px',
                    padding: '14px',
                    background: '#fff7ed',
                    border: '1px solid #fed7aa',
                    borderRadius: '10px',
                    color: '#9a3412'
                  }}
                >
                  <strong>Order numbers not matched</strong>

                  <p style={{ fontSize: '12px', margin: '5px 0 12px' }}>
                    Search these numbers in your Transaction Report.
                  </p>

                  {result.unmatchedOrderNumbers.map((order, index) => (
                    <div
                      key={`${order}-${index}`}
                      style={{
                        padding: '10px',
                        marginTop: '8px',
                        background: '#ffffff',
                        border: '1px solid #fed7aa',
                        borderRadius: '6px',
                        color: '#172033',
                        fontSize: '14px',
                        fontWeight: 700,
                        wordBreak: 'break-all'
                      }}
                    >
                      {order}
                    </div>
                  ))}
                </div>
              )}
          </div>
        )}

        <div className="rules">
          <h2>Import rules</h2>

          <ul>
            <li>Orders go into the selected account and month tab.</li>
            <li>Order Earnings are calculated using the Transaction Report.</li>
            <li>Order net amount and Other fee amounts are combined by order number.</li>
            <li>Existing orders are skipped and are not modified.</li>
            <li>Existing manually entered values are preserved.</li>
            <li>G and H remain for AliExpress data; I contains eBay Order Earnings; J contains the profit formula.</li>
          </ul>
        </div>

        <p className="foot">
          All partners can use this website and the same Google Sheet.
          Duplicate checking is built in.
        </p>

      </section>
    </main>
  );
}
