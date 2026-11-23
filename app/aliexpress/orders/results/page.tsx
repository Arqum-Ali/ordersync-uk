
'use client';

import { useEffect, useState } from 'react';

interface ExtractedOrder {
  orderId: string;
  date?: string;
}

interface ExtractedData {
  accountId: string;
  accountLabel?: string;
  fileName?: string;
  orders: ExtractedOrder[];
}

interface OrderResult {
  orderId: string;
  loading: boolean;
  success: boolean;
  message?: string;
  data?: any;
}

function amount(value: any, currency?: string): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  return currency ? `${value} ${currency}` : String(value);
}

function getCurrency(value: any, fallback = ''): string {
  return value?.currency_code || fallback;
}

function getOrderRows(results: OrderResult[]) {
  const rows: any[] = [];

  for (const item of results) {
    if (!item.success || !item.data) {
      rows.push({
        orderId: item.orderId,
        orderStatus: item.loading ? 'Fetching...' : 'Failed',
        apiResult: item.loading ? 'Fetching...' : item.message || 'Failed',
      });
      continue;
    }

    const order = item.data;
    const store = order.store_info || {};
    const logistics = Array.isArray(order.logistics_info_list)
      ? order.logistics_info_list
      : [];

    const trackingNumbers = logistics
      .map((entry: any) => entry.logistics_no)
      .filter(Boolean)
      .join(', ');

    const logisticsServices = logistics
      .map((entry: any) => entry.logistics_service)
      .filter(Boolean)
      .join(', ');

    const products = Array.isArray(order.child_order_list)
      && order.child_order_list.length > 0
      ? order.child_order_list
      : [{}];

    for (const product of products) {
      const currency =
        getCurrency(product.product_price) ||
        getCurrency(order.order_amount) ||
        getCurrency(order.user_order_amount);

      const shippingCurrency =
        getCurrency(product.actual_shipping_fee) || currency;

      rows.push({
        orderId: item.orderId,
        created: order.gmt_create || '',
        orderStatus: order.order_status || '',
        logisticsStatus: order.logistics_status || '',
        paymentDate: order.order_paidtime_string || '',
        tracking: trackingNumbers,
        logisticsService: logisticsServices,
        storeName: store.store_name || '',
        storeId: store.store_id ?? '',
        storeUrl: store.store_url || '',
        productName: product.product_name || '',
        productId: product.product_id ?? '',
        skuId: product.sku_id || '',
        quantity: product.product_count ?? '',
        productPrice: amount(product.product_price?.amount, currency),
        saleFee: amount(product.sale_fee?.amount, currency),
        actualFee: amount(product.actual_fee?.amount, currency),

        // Use ONLY actual_shipping_fee from AliExpress.
        // Never calculate it from the original shipping fee or discounts.
        shippingFeePaid: amount(
          product.actual_shipping_fee?.amount ?? '0.00',
          shippingCurrency
        ),

        orderAmount: amount(
          order.order_amount?.amount,
          getCurrency(order.order_amount)
        ),
        amountPaid: amount(
          order.user_order_amount?.amount,
          getCurrency(order.user_order_amount)
        ),
        endReason: product.end_reason || '',
        apiResult: 'Retrieved',
      });
    }
  }

  return rows;
}

const columns = [
  ['Order ID', 'orderId'],
  ['Order Created', 'created'],
  ['Order Status', 'orderStatus'],
  ['Logistics Status', 'logisticsStatus'],
  ['Payment Date', 'paymentDate'],
  ['Tracking Number', 'tracking'],
  ['Logistics Service', 'logisticsService'],
  ['Store Name', 'storeName'],
  ['Store ID', 'storeId'],
  ['Product Name', 'productName'],
  ['Product ID', 'productId'],
  ['SKU ID', 'skuId'],
  ['Quantity', 'quantity'],
  ['Product Price', 'productPrice'],
  ['Sale Fee', 'saleFee'],
  ['Actual Fee', 'actualFee'],
  ['Shipping Fee Paid', 'shippingFeePaid'],
  ['Order Amount', 'orderAmount'],
  ['Amount Paid', 'amountPaid'],
  ['End Reason', 'endReason'],
  ['Store URL', 'storeUrl'],
  ['API Result', 'apiResult'],
] as const;

export default function OrderResultsPage() {
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [results, setResults] = useState<OrderResult[]>([]);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadOrders() {
      try {
        const saved = sessionStorage.getItem('aliexpress-extracted-orders');

        if (!saved) {
          setPageLoading(false);
          return;
        }

        const parsed: ExtractedData = JSON.parse(saved);

        if (!parsed.accountId || !Array.isArray(parsed.orders)) {
          throw new Error(
            'Invalid extracted order data. Please upload your Excel file again.'
          );
        }

        // Keep only unique, non-empty Order IDs from Excel.
        const uniqueOrders = Array.from(
          new Map(
            parsed.orders
              .map((order) => ({
                orderId: String(order.orderId || '').trim(),
              }))
              .filter((order) => /^\d+$/.test(order.orderId))
              .map((order) => [order.orderId, order])
          ).values()
        );

        if (cancelled) return;

        setExtracted(parsed);

        setResults(
          uniqueOrders.map((order) => ({
            orderId: order.orderId,
            loading: true,
            success: false,
          }))
        );

        setPageLoading(false);

        // Fetch every unique order directly from AliExpress.
        for (const order of uniqueOrders) {
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

            const apiResponse = await response.json();

            if (cancelled) return;

            if (!response.ok || apiResponse.success !== true) {
              throw new Error(
                apiResponse.message || `API request failed (${response.status})`
              );
            }

            const orderData = apiResponse.data?.result;

            if (!orderData) {
              throw new Error('AliExpress returned no order details.');
            }

            setResults((previous) =>
              previous.map((item) =>
                item.orderId === order.orderId
                  ? {
                      ...item,
                      loading: false,
                      success: true,
                      data: orderData,
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
        console.error('Could not load AliExpress orders:', error);
        setPageLoading(false);
      }
    }

    loadOrders();

    return () => {
      cancelled = true;
    };
  }, []);

  const totalOrders = results.length;
  const successfulOrders = results.filter((item) => item.success).length;
  const failedOrders = results.filter(
    (item) => !item.success && !item.loading
  ).length;
  const pendingOrders = results.filter((item) => item.loading).length;

  const spreadsheetRows = getOrderRows(results);

  if (pageLoading) {
    return <main style={styles.page}>Loading AliExpress orders...</main>;
  }

  if (!extracted) {
    return (
      <main style={styles.page}>
        <section style={styles.panel}>
          <h2>No extracted orders found</h2>
          <p>Please upload your Excel file and extract Order IDs first.</p>
          <a href="/aliexpress/orders">Back to Order Management</a>
        </section>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>ALIEXPRESS ORDER MANAGEMENT</p>
            <h1 style={styles.heading}>Order Results</h1>
            <p style={styles.subtitle}>
              Order information retrieved directly from AliExpress.
            </p>
          </div>

          <a href="/aliexpress/orders" style={styles.backButton}>
            Back to Upload
          </a>
        </header>

        <section style={styles.panel}>
          <h2 style={styles.sectionTitle}>Extraction Summary</h2>

          <div style={styles.summaryGrid}>
            <SummaryItem
              label="AliExpress Account"
              value={extracted.accountLabel || extracted.accountId}
            />
            <SummaryItem
              label="Excel File"
              value={extracted.fileName || ''}
            />
            <SummaryItem
              label="Unique Order IDs"
              value={String(totalOrders)}
            />
          </div>
        </section>

        <section style={styles.statsGrid}>
          <StatCard label="Total Orders" value={totalOrders} />
          <StatCard label="Successful" value={successfulOrders} />
          <StatCard label="Failed" value={failedOrders} />
          <StatCard label="Remaining" value={pendingOrders} />
        </section>

        <section style={styles.panel}>
          <div style={styles.resultsHeader}>
            <div>
              <h2 style={styles.sectionTitle}>AliExpress Order Spreadsheet</h2>
              <p style={styles.subtitle}>
                Each product appears on its own row. All order details come
                from the AliExpress API.
              </p>
            </div>

            <span style={styles.count}>
              {successfulOrders} / {totalOrders} orders retrieved
            </span>
          </div>

          {spreadsheetRows.length === 0 ? (
            <p>No order results are available.</p>
          ) : (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>#</th>
                    {columns.map(([label]) => (
                      <th key={label} style={styles.th}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {spreadsheetRows.map((row, index) => (
                    <tr key={`${row.orderId}-${index}`}>
                      <td style={styles.rowNumber}>{index + 1}</td>

                      {columns.map(([label, key]) => (
                        <td
                          key={label}
                          style={styles.td}
                          title={String(row[key] ?? '')}
                        >
                          {key === 'storeUrl' && row[key] ? (
                            <a
                              href={row[key]}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open Store
                            </a>
                          ) : (
                            String(row[key] ?? '')
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p style={styles.note}>
            Excel supplies only the AliExpress Order IDs. Product, store,
            payment, tracking, shipping and status information is retrieved
            from AliExpress. Tax and discount fields are not displayed.
            Shipping Fee Paid uses only actual_shipping_fee.amount.
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
    maxWidth: '1600px',
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
    minWidth: '1800px',
    borderCollapse: 'collapse',
    fontSize: '13px',
    whiteSpace: 'nowrap',
  },
  th: {
    background: '#eaf0f7',
    color: '#334155',
    textAlign: 'left',
    padding: '12px 14px',
    borderBottom: '1px solid #dce2eb',
    fontWeight: 700,
    position: 'sticky',
    top: 0,
    zIndex: 1,
  },
  rowNumber: {
    background: '#f8fafc',
    padding: '11px 12px',
    borderBottom: '1px solid #edf0f5',
    textAlign: 'center',
    color: '#64748b',
  },
  td: {
    padding: '11px 14px',
    borderBottom: '1px solid #edf0f5',
    color: '#334155',
    maxWidth: '300px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  note: {
    color: '#64748b',
    fontSize: '12px',
    marginTop: '15px',
  },
};
