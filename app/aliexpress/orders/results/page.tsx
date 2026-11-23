
'use client';

import { useEffect, useState } from 'react';

interface ExtractedOrder {
  orderId: string;
  date: string;
}

interface ExcelRow {
  excelRowNumber: number;
  cells: unknown[];
  orderId: string;
  date: string;
}

interface ExtractedData {
  accountId: string;
  accountLabel: string;
  fileName: string;
  sheetName?: string;
  startDate: string;
  endDate: string;
  columns: string[];
  trackingIndex: number;
  statusIndex: number;
  rows: ExcelRow[];
  orders: ExtractedOrder[];
}

interface OrderResult {
  orderId: string;
  date: string;
  loading: boolean;
  success: boolean;
  message?: string;
  data?: any;
}

export default function OrderResultsPage() {
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [results, setResults] = useState<OrderResult[]>([]);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadOrders = async () => {
      try {
        const saved = sessionStorage.getItem('aliexpress-extracted-orders');

        if (!saved) {
          setPageLoading(false);
          return;
        }

        const parsed: ExtractedData = JSON.parse(saved);

        if (!parsed.columns || !parsed.rows || !parsed.orders) {
          throw new Error(
            'This is an older result format. Please upload your Excel file again.'
          );
        }

        if (cancelled) return;

        setExtracted(parsed);

        const initialResults: OrderResult[] = parsed.orders.map((order) => ({
          orderId: order.orderId,
          date: order.date,
          loading: true,
          success: false,
        }));

        setResults(initialResults);
        setPageLoading(false);

        // Retrieve each unique AliExpress order ID once.
        for (const order of parsed.orders) {
          if (cancelled) return;

          try {
            const response = await fetch('/api/aliexpress/order-details', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                accountId: parsed.accountId,
                orderId: order.orderId,
              }),
            });

            const data = await response.json();

            if (cancelled) return;

            setResults((previous) =>
              previous.map((item) =>
                item.orderId === order.orderId
                  ? {
                      ...item,
                      loading: false,
                      success: data.success === true,
                      data: data.success ? data.data?.result : undefined,
                      message: data.success
                        ? undefined
                        : data.message || 'Unable to retrieve order.',
                    }
                  : item
              )
            );
          } catch (error) {
            if (cancelled) return;

            setResults((previous) =>
              previous.map((item) =>
                item.orderId === order.orderId
                  ? {
                      ...item,
                      loading: false,
                      success: false,
                      message:
                        error instanceof Error
                          ? error.message
                          : 'Request failed.',
                    }
                  : item
              )
            );
          }
        }
      } catch (error) {
        console.error('Could not load extracted orders:', error);
        setPageLoading(false);
      }
    };

    loadOrders();

    return () => {
      cancelled = true;
    };
  }, []);

  const getLogistics = (result?: OrderResult) => {
    if (!result?.success || !Array.isArray(result.data?.logistics_info_list)) {
      return [];
    }

    return result.data.logistics_info_list;
  };

  const getTracking = (result?: OrderResult): string => {
    const logistics = getLogistics(result);

    return (
      logistics
        .map((item: any) => item.logistics_no)
        .filter(Boolean)
        .join(', ') || ''
    );
  };

  const getStatus = (result?: OrderResult): string => {
    if (!result) return '';
    if (result.loading) return 'Fetching...';
    if (!result.success) return 'Failed';

    const status =
      result.data?.logistics_status ||
      result.data?.order_status ||
      '';

    return String(status).replace(/_/g, ' ');
  };

  const totalOrders = results.length;
  const completedOrders = results.filter((order) => order.success).length;
  const failedOrders = results.filter(
    (order) => !order.success && !order.loading
  ).length;
  const pendingOrders = results.filter((order) => order.loading).length;

  if (pageLoading) {
    return (
      <main style={styles.page}>
        <div style={styles.panel}>Loading extracted orders...</div>
      </main>
    );
  }

  if (!extracted) {
    return (
      <main style={styles.page}>
        <div style={styles.panel}>
          <h2>No extracted orders found</h2>
          <p>Please upload your Excel file and extract order IDs first.</p>
          <a href="/aliexpress/orders" style={styles.link}>
            Back to Order Management
          </a>
        </div>
      </main>
    );
  }

  // Match each Excel row to its corresponding API result.
  const resultMap = new Map(results.map((result) => [result.orderId, result]));

  const displayRows = extracted.rows.map((row) => {
    const result = resultMap.get(row.orderId);
    const cells = [...row.cells];

    while (cells.length < extracted.columns.length) {
      cells.push('');
    }

    const tracking = getTracking(result);
    const status = getStatus(result);

    if (tracking) {
      cells[extracted.trackingIndex] = tracking;
    }

    if (status) {
      cells[extracted.statusIndex] = status;
    }

    return {
      ...row,
      cells,
      result,
    };
  });

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <p style={styles.eyebrow}>ALIEXPRESS ORDER MANAGEMENT</p>
            <h1 style={styles.heading}>Order Results</h1>
            <p style={styles.subtitle}>
              Your original Excel data with AliExpress tracking and status.
            </p>
          </div>

          <a href="/aliexpress/orders" style={styles.backButton}>
            Back to Upload
          </a>
        </div>

        <section style={styles.panel}>
          <h2 style={styles.sectionTitle}>Extraction Summary</h2>

          <div style={styles.summaryGrid}>
            <SummaryItem
              label="AliExpress Account"
              value={extracted.accountLabel || extracted.accountId}
            />

            <SummaryItem label="Excel File" value={extracted.fileName} />

            <SummaryItem
              label="Date Range"
              value={`${extracted.startDate} to ${extracted.endDate}`}
            />

            <SummaryItem
              label="Excel Rows"
              value={String(extracted.rows.length)}
            />

            <SummaryItem
              label="Unique Order IDs"
              value={String(totalOrders)}
            />
          </div>
        </section>

        <section style={styles.statsGrid}>
          <StatCard label="Total Orders" value={totalOrders} />
          <StatCard label="Successful" value={completedOrders} />
          <StatCard label="Failed" value={failedOrders} />
          <StatCard label="Remaining" value={pendingOrders} />
        </section>

        <section style={styles.panel}>
          <div style={styles.resultsHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Excel Order Spreadsheet</h2>
              <p style={styles.subtitle}>
                All matching rows from your uploaded Excel file.
              </p>
            </div>

            <span style={styles.count}>
              {completedOrders} / {totalOrders} API requests completed
            </span>
          </div>

          {displayRows.length === 0 ? (
            <p>No order rows were found.</p>
          ) : (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.rowNumberHeader}>#</th>
                    {extracted.columns.map((column, index) => (
                      <th key={`${column}-${index}`} style={styles.th}>
                        {column || `Column ${index + 1}`}
                      </th>
                    ))}
                    <th style={styles.th}>API Result</th>
                  </tr>
                </thead>

                <tbody>
                  {displayRows.map((row, rowIndex) => (
                    <tr key={`${row.excelRowNumber}-${row.orderId}`}>
                      <td style={styles.rowNumberCell}>
                        {rowIndex + 1}
                      </td>

                      {row.cells.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          style={{
                            ...styles.td,
                            ...(cellIndex === extracted.trackingIndex
                              ? styles.trackingCell
                              : {}),
                            ...(cellIndex === extracted.statusIndex
                              ? styles.statusCell
                              : {}),
                          }}
                          title={String(cell ?? '')}
                        >
                          {cell === null || cell === undefined
                            ? ''
                            : String(cell)}
                        </td>
                      ))}

                      <td style={styles.td}>
                        {row.result?.loading ? (
                          <span style={styles.loadingBadge}>Fetching...</span>
                        ) : row.result?.success ? (
                          <span style={styles.successBadge}>Retrieved</span>
                        ) : (
                          <span
                            style={styles.errorBadge}
                            title={row.result?.message || 'Request failed'}
                          >
                            {row.result ? 'Failed' : 'Pending'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p style={styles.tableNote}>
            The original Excel data is kept unchanged. Tracking and Status are
            filled from the AliExpress response when available. If an API
            request fails, the row remains visible and its original data is
            preserved.
          </p>
        </section>
      </div>
    </main>
  );
}

function SummaryItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p style={styles.smallLabel}>{label}</p>
      <p style={styles.summaryValue}>{value}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div style={styles.statCard}>
      <p style={styles.smallLabel}>{label}</p>
      <h2 style={styles.statValue}>{value}</h2>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f5f7fb',
    padding: '35px 20px',
    color: '#172033',
  },
  container: {
    maxWidth: '1500px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '20px',
    marginBottom: '25px',
  },
  eyebrow: {
    color: '#64748b',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '1px',
  },
  heading: {
    fontSize: '30px',
    margin: '8px 0',
  },
  subtitle: {
    color: '#64748b',
    fontSize: '14px',
  },
  backButton: {
    background: '#fff',
    border: '1px solid #dce2eb',
    padding: '11px 17px',
    borderRadius: '8px',
    textDecoration: 'none',
    color: '#172033',
    fontWeight: 600,
  },
  panel: {
    background: '#fff',
    border: '1px solid #e5eaf1',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '22px',
  },
  sectionTitle: {
    fontSize: '19px',
    margin: '0 0 18px',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: '22px',
  },
  smallLabel: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#8490a3',
    textTransform: 'uppercase',
    margin: '0 0 7px',
    letterSpacing: '0.4px',
  },
  summaryValue: {
    fontSize: '14px',
    fontWeight: 600,
    overflowWrap: 'anywhere',
    margin: 0,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '14px',
    marginBottom: '22px',
  },
  statCard: {
    background: '#fff',
    border: '1px solid #e5eaf1',
    borderRadius: '10px',
    padding: '18px',
  },
  statValue: {
    fontSize: '26px',
    margin: 0,
  },
  resultsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '12px',
    marginBottom: '18px',
  },
  count: {
    fontSize: '13px',
    color: '#475569',
    fontWeight: 600,
  },
  tableWrapper: {
    width: '100%',
    overflowX: 'auto',
    border: '1px solid #dce2eb',
    borderRadius: '8px',
  },
  table: {
    width: '100%',
    minWidth: '1100px',
    borderCollapse: 'collapse',
    fontSize: '13px',
    whiteSpace: 'nowrap',
  },
  rowNumberHeader: {
    background: '#eaf0f7',
    padding: '12px',
    borderBottom: '1px solid #dce2eb',
    textAlign: 'center',
    color: '#475569',
    position: 'sticky',
    left: 0,
    zIndex: 2,
  },
  th: {
    background: '#eaf0f7',
    color: '#334155',
    textAlign: 'left',
    padding: '12px 14px',
    borderBottom: '1px solid #dce2eb',
    fontWeight: 700,
  },
  rowNumberCell: {
    background: '#f8fafc',
    padding: '11px 12px',
    borderBottom: '1px solid #edf0f5',
    textAlign: 'center',
    color: '#64748b',
    position: 'sticky',
    left: 0,
    zIndex: 1,
  },
  td: {
    padding: '11px 14px',
    borderBottom: '1px solid #edf0f5',
    color: '#334155',
    maxWidth: '280px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  trackingCell: {
    color: '#075985',
    fontWeight: 600,
  },
  statusCell: {
    color: '#166534',
    fontWeight: 600,
  },
  tableNote: {
    color: '#64748b',
    fontSize: '12px',
    marginTop: '15px',
  },
  successBadge: {
    background: '#dcfce7',
    color: '#166534',
    borderRadius: '20px',
    padding: '6px 10px',
    fontSize: '11px',
    fontWeight: 700,
  },
  errorBadge: {
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: '20px',
    padding: '6px 10px',
    fontSize: '11px',
    fontWeight: 700,
  },
  loadingBadge: {
    background: '#e0f2fe',
    color: '#075985',
    borderRadius: '20px',
    padding: '6px 10px',
    fontSize: '11px',
    fontWeight: 700,
  },
  link: {
    display: 'inline-block',
    marginTop: '12px',
    color: '#2563eb',
  },
};
