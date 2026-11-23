
'use client';

import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import Link from 'next/link';
import styles from './orders.module.css';

type AliExpressAccount = {
  account_label: string;
  aliexpress_user_id: string;
  connection_status: string;
  access_token_expires_at: string;
};

type ExtractedOrder = {
  orderId: string;
  date: string;
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function parseExcelDate(value: unknown, fallbackYear: number): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-');
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(
        parsed.d
      ).padStart(2, '0')}`;
    }
  }

  const text = String(value ?? '').trim();
  if (!text) return null;

  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);

  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(
      2,
      '0'
    )}`;
  }

  match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);

  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(
      2,
      '0'
    )}`;
  }

  const monthNames = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  ];

  match = text.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{2,4})$/);

  if (match) {
    const month = monthNames.indexOf(match[2].slice(0, 3).toLowerCase());
    let year = Number(match[3]);

    if (year < 100) {
      year += year >= 70 ? 1900 : 2000;
    }

    if (month !== -1) {
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(
        Number(match[1])
      ).padStart(2, '0')}`;
    }
  }

  match = text.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,})$/);

  if (match) {
    const month = monthNames.indexOf(match[2].slice(0, 3).toLowerCase());

    if (month !== -1) {
      return `${fallbackYear}-${String(month + 1).padStart(2, '0')}-${String(
        Number(match[1])
      ).padStart(2, '0')}`;
    }
  }

  return null;
}

export default function AliExpressOrdersPage() {
  const [accounts, setAccounts] = useState<AliExpressAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [processing, setProcessing] = useState(false);

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

  async function extractOrders() {
    if (!file || !startDate || !endDate || !selectedAccount) return;

    setProcessing(true);
    setError('');

    try {
      const buffer = await file.arrayBuffer();

      const workbook = XLSX.read(buffer, {
        type: 'array',
        cellDates: true,
      });

      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        throw new Error('The Excel file does not contain a worksheet.');
      }

      const worksheet = workbook.Sheets[firstSheetName];

      const matrix = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '',
        raw: false,
      }) as unknown[][];

      if (matrix.length < 2) {
        throw new Error('The Excel sheet has no order data.');
      }

      const originalHeaders = matrix[0].map((value) =>
        String(value ?? '').trim()
      );

      const headers = originalHeaders.map(normalizeHeader);

      const dateIndex = headers.indexOf('date');
      const orderIdIndex = headers.indexOf('aliexpressorderid');

      if (dateIndex === -1) {
        throw new Error('Could not find the "Date" column.');
      }

      if (orderIdIndex === -1) {
        throw new Error('Could not find the "Ali Express order ID" column.');
      }

      // Preserve every original Excel column.
      const columns = [...originalHeaders];

      // Add Tracking and Status columns if they do not already exist.
      let trackingIndex = headers.indexOf('tracking');

      if (trackingIndex === -1) {
        trackingIndex = columns.length;
        columns.push('Tracking');
      }

      let statusIndex = headers.indexOf('status');

      if (statusIndex === -1) {
        statusIndex = columns.length;
        columns.push('Status');
      }

      const matchingRows: {
        excelRowNumber: number;
        cells: unknown[];
        orderId: string;
        date: string;
      }[] = [];

      const uniqueOrders = new Map<string, ExtractedOrder>();

      let matchingDateRows = 0;

      for (let index = 1; index < matrix.length; index++) {
        const originalRow = matrix[index];
        const orderDate = parseExcelDate(
          originalRow[dateIndex],
          Number(startDate.substring(0, 4))
        );

        if (!orderDate || orderDate < startDate || orderDate > endDate) {
          continue;
        }

        matchingDateRows++;

        const orderId = String(originalRow[orderIdIndex] ?? '').trim();

        if (!orderId) continue;

        // Preserve all cells, including blank cells.
        const cells = [...originalRow];

        while (cells.length < columns.length) {
          cells.push('');
        }

        matchingRows.push({
          excelRowNumber: index + 1,
          cells,
          orderId,
          date: orderDate,
        });

        // Only request each unique AliExpress ID once.
        if (!uniqueOrders.has(orderId)) {
          uniqueOrders.set(orderId, {
            orderId,
            date: orderDate,
          });
        }
      }

      const extractedOrders = Array.from(uniqueOrders.values());

      if (matchingRows.length === 0) {
        throw new Error(
          'No orders with AliExpress order IDs were found in the selected date range.'
        );
      }

      const savedResults = {
        accountId: selectedAccount,
        accountLabel:
          accounts.find(
            (account) => account.aliexpress_user_id === selectedAccount
          )?.account_label || selectedAccount,
        fileName: file.name,
        sheetName: firstSheetName,
        startDate,
        endDate,
        matchingDateRows,
        rowsWithOrderIds: matchingRows.length,
        columns,
        trackingIndex,
        statusIndex,
        rows: matchingRows,
        orders: extractedOrders,
      };

      sessionStorage.setItem(
        'aliexpress-extracted-orders',
        JSON.stringify(savedResults)
      );

      window.location.href = '/aliexpress/orders/results';
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not read the Excel file.'
      );
    } finally {
      setProcessing(false);
    }
  }

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

          {accounts.map((account) => (
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
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>

            <div>
              <label className={styles.fieldLabel}>End Date</label>
              <input
                className={styles.dateInput}
                type="date"
                min={startDate || undefined}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </div>

          <p className={styles.mutedText}>
            Only orders within this date range will be extracted.
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
              onChange={(event) =>
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

        {error && <p style={{ color: 'red' }}>{error}</p>}

        <button
          type="button"
          className={styles.primaryButton}
          disabled={!canContinue || processing}
          onClick={extractOrders}
          style={{
            opacity: canContinue && !processing ? 1 : 0.5,
            cursor: canContinue && !processing ? 'pointer' : 'not-allowed',
          }}
        >
          {processing ? 'Reading Excel File...' : 'Extract Order IDs'}
        </button>

        <p className={styles.mutedText}>
          Your original Excel rows and columns will be preserved on the
          Results page. Each unique AliExpress order ID will be retrieved once.
        </p>

        <p>
          <Link href="/aliexpress/orders/results">View Previous Results</Link>
        </p>
      </section>
    </main>
  );
}
