
'use client';

import { useEffect, useState } from 'react';

interface ExtractedOrder {
  orderId: string;
  date: string;
}

interface ExtractedData {
  accountId: string;
  accountLabel: string;
  fileName: string;
  startDate: string;
  endDate: string;
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
    const loadOrders = async () => {
      try {
        const saved = sessionStorage.getItem(
          'aliexpress-extracted-orders'
        );

        if (!saved) {
          setPageLoading(false);
          return;
        }

        const parsed: ExtractedData = JSON.parse(saved);

        setExtracted(parsed);

        const initialResults: OrderResult[] = parsed.orders.map(
          (order) => ({
            orderId: order.orderId,
            date: order.date,
            loading: true,
            success: false,
          })
        );

        setResults(initialResults);
        setPageLoading(false);

        // Process orders one by one.
        for (const order of parsed.orders) {
          try {
            const response = await fetch(
              '/api/aliexpress/order-details',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  accountId: parsed.accountId,
                  orderId: order.orderId,
                }),
              }
            );

            const data = await response.json();

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
  }, []);

  const getLogistics = (order: OrderResult) => {
    return Array.isArray(order.data?.logistics_info_list)
      ? order.data.logistics_info_list
      : [];
  };

  const getStatus = (value?: string) => {
    if (!value) return 'Not available';

    return value.replace(/_/g, ' ');
  };

  const totalOrders = results.length;
  const completedOrders = results.filter(
    (order) => order.success
  ).length;
  const failedOrders = results.filter(
    (order) => !order.success && !order.loading
  ).length;
  const pendingOrders = results.filter(
    (order) => order.loading
  ).length;

  if (pageLoading) {
    return (
      <main style={styles.page}>
        <div style={styles.panel}>
          Loading extracted orders...
        </div>
      </main>
    );
  }

  if (!extracted) {
    return (
      <main style={styles.page}>
        <div style={styles.panel}>
          <h2>No extracted orders found</h2>
          <p>
            Please upload your Excel file and extract order IDs first.
          </p>
          <a href="/aliexpress/orders" style={styles.link}>
            Back to Order Management
          </a>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.container}>

        <div style={styles.header}>
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
        </div>

        {/* Upload information */}
        <section style={styles.panel}>
          <h2 style={styles.sectionTitle}>Extraction Summary</h2>

          <div style={styles.summaryGrid}>
            <SummaryItem
              label="AliExpress Account"
              value={extracted.accountLabel || extracted.accountId}
            />

            <SummaryItem
              label="Excel File"
              value={extracted.fileName}
            />

            <SummaryItem
              label="Date Range"
              value={`${extracted.startDate} to ${extracted.endDate}`}
            />

            <SummaryItem
              label="Unique Order IDs"
              value={String(totalOrders)}
            />
          </div>
        </section>

        {/* Processing summary */}
        <section style={styles.statsGrid}>
          <StatCard label="Total Orders" value={totalOrders} />
          <StatCard label="Successful" value={completedOrders} />
          <StatCard label="Failed" value={failedOrders} />
          <StatCard label="Remaining" value={pendingOrders} />
        </section>

        {/* Order results */}
        <section style={styles.panel}>
          <div style={styles.resultsHeader}>
            <div>
              <h2 style={styles.sectionTitle}>AliExpress Order Details</h2>
              <p style={styles.subtitle}>
                Each order is retrieved separately from AliExpress.
              </p>
            </div>

            <span style={styles.count}>
              {completedOrders} / {totalOrders} completed
            </span>
          </div>

          {results.length === 0 ? (
            <p>No order IDs were found in your Excel file.</p>
          ) : (
            <div style={styles.orderList}>
              {results.map((order) => {
                const logistics = getLogistics(order);

                return (
                  <article
                    key={order.orderId}
                    style={styles.orderCard}
                  >
                    <div style={styles.orderHeader}>
                      <div>
                        <p style={styles.smallLabel}>ORDER ID</p>
                        <h3 style={styles.orderId}>
                          {order.orderId}
                        </h3>
                        <p style={styles.date}>
                          Excel Date: {order.date}
                        </p>
                      </div>

                      <div>
                        {order.loading ? (
                          <span style={styles.loadingBadge}>
                            Fetching...
                          </span>
                        ) : order.success ? (
                          <span style={styles.successBadge}>
                            Retrieved
                          </span>
                        ) : (
                          <span style={styles.errorBadge}>
                            Failed
                          </span>
                        )}
                      </div>
                    </div>

                    {order.loading && (
                      <p style={styles.muted}>
                        Retrieving order details from AliExpress...
                      </p>
                    )}

                    {!order.success && !order.loading && (
                      <div style={styles.errorBox}>
                        <strong>Request failed</strong>
                        <p>{order.message}</p>
                      </div>
                    )}

                    {order.success && order.data && (
                      <>
                        <div style={styles.detailsGrid}>
                          <Detail
                            label="Order Status"
                            value={getStatus(order.data.order_status)}
                          />

                          <Detail
                            label="Logistics Status"
                            value={getStatus(order.data.logistics_status)}
                          />

                          <Detail
                            label="Order Created"
                            value={order.data.gmt_create || 'Not available'}
                          />

                          <Detail
                            label="Order Amount"
                            value={
                              order.data.order_amount
                                ? `${order.data.order_amount.currency_code || ''} ${order.data.order_amount.amount || ''}`
                                : 'Not available'
                            }
                          />

                          <Detail
                            label="Store Name"
                            value={
                              order.data.store_info?.store_name ||
                              'Not available'
                            }
                          />

                          <Detail
                            label="Store ID"
                            value={
                              order.data.store_info?.store_id
                                ? String(order.data.store_info.store_id)
                                : 'Not available'
                            }
                          />
                        </div>

                        <div style={styles.logisticsSection}>
                          <h4 style={styles.logisticsTitle}>
                            Tracking & Logistics Information
                          </h4>

                          {logistics.length === 0 ? (
                            <p style={styles.muted}>
                              No logistics information returned for this order.
                            </p>
                          ) : (
                            logistics.map((item: any, index: number) => (
                              <div
                                key={index}
                                style={styles.logisticsCard}
                              >
                                <Detail
                                  label="Tracking Number"
                                  value={
                                    item.logistics_no || 'Not available'
                                  }
                                />

                                <Detail
                                  label="Courier / Service"
                                  value={
                                    item.logistics_service || 'Not available'
                                  }
                                />

                                <Detail
                                  label="Logistics Information"
                                  value={JSON.stringify(item)}
                                />
                              </div>
                            ))
                          )}
                        </div>

                        {Array.isArray(order.data.child_order_list) && (
                          <details style={styles.rawDetails}>
                            <summary>
                              View Child Order Details
                            </summary>
                            <pre style={styles.rawData}>
                              {JSON.stringify(
                                order.data.child_order_list,
                                null,
                                2
                              )}
                            </pre>
                          </details>
                        )}
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          )}
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

function Detail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div style={styles.detail}>
      <p style={styles.smallLabel}>{label}</p>
      <p style={styles.detailValue}>{value}</p>
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
    maxWidth: '1150px',
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
  },
  count: {
    fontSize: '13px',
    color: '#475569',
    fontWeight: 600,
  },
  orderList: {
    display: 'grid',
    gap: '18px',
  },
  orderCard: {
    border: '1px solid #e5eaf1',
    borderRadius: '10px',
    padding: '20px',
    background: '#fff',
  },
  orderHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '12px',
    paddingBottom: '17px',
    borderBottom: '1px solid #edf0f5',
  },
  orderId: {
    fontSize: '18px',
    margin: '0 0 5px',
    overflowWrap: 'anywhere',
  },
  date: {
    fontSize: '12px',
    color: '#64748b',
    margin: 0,
  },
  successBadge: {
    background: '#dcfce7',
    color: '#166534',
    borderRadius: '20px',
    padding: '7px 12px',
    fontSize: '12px',
    fontWeight: 700,
  },
  errorBadge: {
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: '20px',
    padding: '7px 12px',
    fontSize: '12px',
    fontWeight: 700,
  },
  loadingBadge: {
    background: '#e0f2fe',
    color: '#075985',
    borderRadius: '20px',
    padding: '7px 12px',
    fontSize: '12px',
    fontWeight: 700,
  },
  muted: {
    color: '#64748b',
    fontSize: '13px',
    marginTop: '16px',
  },
  errorBox: {
    background: '#fff1f2',
    border: '1px solid #fecdd3',
    color: '#9f1239',
    padding: '14px',
    borderRadius: '8px',
    marginTop: '16px',
    fontSize: '13px',
    overflowWrap: 'anywhere',
  },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: '20px',
    padding: '20px 0',
  },
  detail: {
    minWidth: 0,
  },
  detailValue: {
    fontSize: '14px',
    fontWeight: 600,
    margin: 0,
    overflowWrap: 'anywhere',
  },
  logisticsSection: {
    borderTop: '1px solid #edf0f5',
    paddingTop: '18px',
  },
  logisticsTitle: {
    fontSize: '15px',
    margin: '0 0 14px',
  },
  logisticsCard: {
    background: '#f8fafc',
    border: '1px solid #e5eaf1',
    borderRadius: '8px',
    padding: '15px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '10px',
  },
  rawDetails: {
    marginTop: '18px',
    fontSize: '13px',
    color: '#475569',
  },
  rawData: {
    background: '#f1f5f9',
    padding: '14px',
    borderRadius: '8px',
    overflowX: 'auto',
    fontSize: '12px',
  },
  link: {
    display: 'inline-block',
    marginTop: '12px',
    color: '#2563eb',
  },
};

