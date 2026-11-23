
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '../orders.module.css';

type ExtractedOrder = {
  orderId: string;
  date: string;
};

type StoredResults = {
  accountId: string;
  accountLabel: string;
  fileName: string;
  startDate: string;
  endDate: string;
  orders: ExtractedOrder[];
};

export default function AliExpressOrderResultsPage() {
  const [results, setResults] = useState<StoredResults | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem('aliexpress-extracted-orders');

    if (saved) {
      try {
        setResults(JSON.parse(saved));
      } catch {
        setResults(null);
      }
    }
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>ALIEXPRESS INTEGRATION</div>

        <h1>Extracted Order IDs</h1>

        <p className={styles.intro}>
          These order IDs were extracted from your Excel file.
        </p>

        {!results ? (
          <div className={styles.section}>
            <div className={styles.emptyState}>
              No extracted data is available.
              <br />
              Go back and upload your Excel file first.
            </div>
          </div>
        ) : (
          <>
            <div className={styles.section}>
              <strong className={styles.sectionTitle}>Extraction Summary</strong>

              <p>
                <strong>Account:</strong> {results.accountLabel}
              </p>

              <p>
                <strong>Excel File:</strong> {results.fileName}
              </p>

              <p>
                <strong>Date Range:</strong> {results.startDate} to {results.endDate}
              </p>

              <p>
                <strong>Unique Order IDs Found:</strong> {results.orders.length}
              </p>
            </div>

            <div className={styles.section}>
              <strong className={styles.sectionTitle}>Extracted Orders</strong>

              {results.orders.length === 0 ? (
                <div className={styles.emptyState}>
                  No AliExpress order IDs were found in the selected date range.
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.resultsTable}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>AliExpress Order ID</th>
                        <th>Order Date</th>
                      </tr>
                    </thead>

                    <tbody>
                      {results.orders.map((order, index) => (
                        <tr key={`${order.orderId}-${index}`}>
                          <td>{index + 1}</td>
                          <td>{order.orderId}</td>
                          <td>{order.date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        <Link
          href="/aliexpress/orders"
          className={styles.secondaryButton}
        >
          ← Back to Order Management
        </Link>
      </section>
    </main>
  );
}
