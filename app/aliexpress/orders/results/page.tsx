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
  trackingMessage?: string;
  data?: any;
  trackingData?: any;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function amount(value: any, currency?: string): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  return currency ? `${value} ${currency}` : String(value);
}

function getCurrency(value: any, fallback = ''): string {
  return value?.currency_code || fallback;
}

function toTimestamp(value: any): number | null {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return number < 1e12 ? number * 1000 : number;
}

function parseOrderDate(value: any): number | null {
  if (!value) return null;

  const dateString = String(value).trim();
  const normalized = dateString.includes('T')
    ? dateString
    : dateString.replace(' ', 'T');

  const timestamp = Date.parse(
    /Z$|[+-]\d{2}:\d{2}$/.test(normalized)
      ? normalized
      : `${normalized}Z`
  );

  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDate(value: any): string {
  const timestamp = toTimestamp(value);

  if (!timestamp) return '';

  return new Date(timestamp).toLocaleString('en-GB');
}

function formatOrderDate(value: any): string {
  const timestamp = parseOrderDate(value);

  if (!timestamp) return String(value || '');

  return new Date(timestamp).toLocaleString('en-GB');
}

function isDeliveryEvent(event: any): boolean {
  const name = String(event?.tracking_name || '').toLowerCase();
  const description = String(
    event?.tracking_detail_desc || ''
  ).toLowerCase();

  return (
    name.includes('delivered') ||
    description.includes('package delivered') ||
    description.includes('successfully delivered') ||
    description.includes('delivered to recipient')
  );
}

function getTrackingSummary(orderResult: OrderResult, order: any) {
  const trackingResult =
    orderResult.trackingData?.data?.result;

  const lines = Array.isArray(
    trackingResult?.data?.tracking_detail_line_list
  )
    ? trackingResult.data.tracking_detail_line_list
    : [];

  const events = lines.flatMap((line: any) =>
    (Array.isArray(line.detail_node_list)
      ? line.detail_node_list
      : []
    ).map((event: any) => ({
      ...event,
      timestamp: toTimestamp(event.time_stamp),
    }))
  );

  const sortedEvents = events
    .filter((event: any) => event.timestamp)
    .sort(
      (a: any, b: any) => b.timestamp - a.timestamp
    );

  const latestEvent = sortedEvents[0];

  const trackingNumbers = lines
    .map((line: any) => line.mail_no)
    .filter(Boolean);

  const fallbackLogistics = Array.isArray(
    order.logistics_info_list
  )
    ? order.logistics_info_list
    : [];

  const trackingNumber =
    trackingNumbers.length > 0
      ? [...new Set(trackingNumbers)].join(', ')
      : fallbackLogistics
          .map((item: any) => item.logistics_no)
          .filter(Boolean)
          .join(', ');

  const couriers = lines.flatMap((line: any) =>
    [line.carrier_name, line.cp_name].filter(Boolean)
  );

  const uniqueCouriers = [...new Set(couriers)];

  const deliveryEvents = sortedEvents.filter(
    (event: any) => isDeliveryEvent(event)
  );

  const allPackagesDelivered =
    lines.length > 0 &&
    lines.every((line: any) =>
      Array.isArray(line.detail_node_list) &&
      line.detail_node_list.some((event: any) =>
        isDeliveryEvent(event)
      )
    );

  const deliveryTimestamp = allPackagesDelivered
    ? Math.max(
        ...deliveryEvents.map(
          (event: any) => event.timestamp
        )
      )
    : null;

  const orderTimestamp = parseOrderDate(order.gmt_create);

  let deliveryDays = '';
  let deliveryPerformance = 'Not Delivered';
  let deliveryDate = '';

  if (!trackingResult?.ret && lines.length === 0) {
    deliveryPerformance = 'Tracking Data Not Found';
  } else if (deliveryTimestamp && orderTimestamp) {
    const difference = deliveryTimestamp - orderTimestamp;

    if (difference >= 0) {
      deliveryDays = `${(difference / DAY_MS).toFixed(1)} days`;

      deliveryPerformance =
        difference > 10 * DAY_MS ? 'Late' : 'On Time';

      deliveryDate = formatDate(deliveryTimestamp);
    } else {
      deliveryPerformance = 'Date Check Required';
      deliveryDate = formatDate(deliveryTimestamp);
    }
  } else if (deliveryTimestamp) {
    deliveryDate = formatDate(deliveryTimestamp);
    deliveryPerformance = 'Order Date Unavailable';
  }

  return {
    courier: uniqueCouriers.join(' / '),
    tracking: trackingNumber,
    latestTrackingEvent: latestEvent?.tracking_name || '',
    description: latestEvent?.tracking_detail_desc || '',
    deliveryDate,
    deliveryDays,
    deliveryPerformance,
  };
}

function getOrderRows(results: OrderResult[]) {
  const rows: any[] = [];

  for (const item of results) {
    if (!item.success || !item.data) {
      rows.push({
        orderId: item.orderId,
        orderStatus: item.loading ? 'Fetching...' : 'Failed',
        apiResult: item.loading
          ? 'Fetching...'
          : item.message || 'Failed',
      });

      continue;
    }

    const order = item.data;
    const store = order.store_info || {};

    const tracking = getTrackingSummary(item, order);

    const products =
      Array.isArray(order.child_order_list) &&
      order.child_order_list.length > 0
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

        created: formatOrderDate(order.gmt_create),
        orderStatus: order.order_status || '',
        paymentDate: order.order_paidtime_string || '',

        courier: tracking.courier,
        tracking: tracking.tracking,
        latestTrackingEvent: tracking.latestTrackingEvent,
        description: tracking.description,
        deliveryDate: tracking.deliveryDate,
        deliveryDays: tracking.deliveryDays,
        deliveryPerformance: tracking.deliveryPerformance,

        storeName: store.store_name || '',
        storeId: store.store_id ?? '',

        productName: product.product_name || '',
        productId: product.product_id ?? '',
        skuId: product.sku_id || '',
        quantity: product.product_count ?? '',

        productPrice: amount(
          product.product_price?.amount,
          currency
        ),

        saleFee: amount(
          product.sale_fee?.amount,
          currency
        ),

        actualFee: amount(
          product.actual_fee?.amount,
          currency
        ),

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
        storeUrl: store.store_url || '',

        apiResult: item.trackingMessage
          ? `Order Retrieved; ${item.trackingMessage}`
          : 'Order and Tracking Retrieved',
      });
    }
  }

  return rows;
}

const columns = [
  ['Order ID', 'orderId'],
  ['Order Created', 'created'],
  ['Order Status', 'orderStatus'],
  ['Payment Date', 'paymentDate'],

  ['Courier', 'courier'],
  ['Tracking Number', 'tracking'],
  ['Latest Tracking Event', 'latestTrackingEvent'],
  ['Description', 'description'],
  ['Delivery Date', 'deliveryDate'],
  ['Delivery Days', 'deliveryDays'],
  ['Delivery Performance', 'deliveryPerformance'],

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
  const [extracted, setExtracted] =
    useState<ExtractedData | null>(null);

  const [results, setResults] = useState<OrderResult[]>([]);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadOrders() {
      try {
        const saved = sessionStorage.getItem(
          'aliexpress-extracted-orders'
        );

        if (!saved) {
          setPageLoading(false);
          return;
        }

        const parsed: ExtractedData = JSON.parse(saved);

        if (
          !parsed.accountId ||
          !Array.isArray(parsed.orders)
        ) {
          throw new Error(
            'Invalid extracted order data. Upload your Excel file again.'
          );
        }

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

        for (const order of uniqueOrders) {
          if (cancelled) return;

          try {
            const orderResponse = await fetch(
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

            const orderApi = await orderResponse.json();

            if (!orderResponse.ok || orderApi.success !== true) {
              throw new Error(
                orderApi.message ||
                `Order API failed (${orderResponse.status})`
              );
            }

            const orderData = orderApi.data?.result;

            if (!orderData) {
              throw new Error(
                'AliExpress returned no order details.'
              );
            }

            if (cancelled) return;

            let trackingData: any = undefined;
            let trackingMessage = '';

            try {
              const trackingResponse = await fetch(
                '/api/aliexpress/order-tracking',
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    accountId: parsed.accountId,
                    orderId: order.orderId,
                    language: 'en_US',
                  }),
                }
              );

              const trackingApi = await trackingResponse.json();

              if (!trackingResponse.ok || trackingApi.success !== true) {
                trackingMessage =
                  trackingApi.message ||
                  `Tracking API failed (${trackingResponse.status})`;
              } else {
                trackingData = trackingApi;

                if (trackingApi.data?.result?.ret !== true) {
                  trackingMessage =
                    trackingApi.data?.result?.msg ||
                    'Tracking Data Not Found';
                }
              }
            } catch (trackingError) {
              trackingMessage =
                trackingError instanceof Error
                  ? trackingError.message
                  : 'Tracking request failed.';
            }

            if (cancelled) return;

            setResults((previous) =>
              previous.map((item) =>
                item.orderId === order.orderId
                  ? {
                      ...item,
                      loading: false,
                      success: true,
                      data: orderData,
                      trackingData,
                      trackingMessage,
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
        console.error(
          'Could not load AliExpress orders:',
          error
        );

        setPageLoading(false);
      }
    }

    loadOrders();

    return () => {
      cancelled = true;
    };
  }, []);

  const spreadsheetRows = getOrderRows(results);

  if (pageLoading) {
    return (
      <main style={styles.page}>
        Loading AliExpress orders...
      </main>
    );
  }

  if (!extracted) {
    return (
      <main style={styles.page}>
        <section style={styles.panel}>
          <h2>No extracted orders found</h2>
          <p>
            Please upload your Excel file and extract Order IDs first.
          </p>
          <a href="/aliexpress/orders">
            Back to Order Management
          </a>
        </section>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>
              ALIEXPRESS ORDER MANAGEMENT
            </p>

            <h1 style={styles.heading}>
              Order Results
            </h1>

            <p style={styles.subtitle}>
              Order and tracking information retrieved directly
              from AliExpress.
            </p>
          </div>

          <a
            href="/aliexpress/orders"
            style={styles.backButton}
          >
            Back to Upload
          </a>
        </header>

        <section style={styles.panel}>
          <div style={styles.resultsHeader}>
            <div>
              <h2 style={styles.sectionTitle}>
                AliExpress Order Spreadsheet
              </h2>

              <p style={styles.subtitle}>
                Each product appears on its own row.
                Order and tracking information comes from AliExpress.
              </p>
            </div>
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
                      <td style={styles.rowNumber}>
                        {index + 1}
                      </td>

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
                          ) : key === 'deliveryPerformance' ? (
                            <span
                              style={{
                                fontWeight: 700,
                                color:
                                  row[key] === 'On Time'
                                    ? '#15803d'
                                    : row[key] === 'Late'
                                      ? '#dc2626'
                                      : '#64748b',
                              }}
                            >
                              {String(row[key] ?? '')}
                            </span>
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
            Excel supplies only the AliExpress Order IDs.
            Order, product, store, payment and tracking information
            is retrieved from AliExpress. Delivery is Late only
            when the confirmed delivery timestamp is more than
            10 full days after the order creation timestamp.
            Tracking information unavailable from AliExpress
            does not cause the order details to be discarded.
            Tax and discount columns are excluded.
            Shipping Fee Paid uses only actual_shipping_fee.amount.
          </p>
        </section>
      </div>
    </main>
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

  resultsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '12px',
    marginBottom: '18px',
  },

  tableWrapper: {
    width: '100%',
    overflowX: 'auto',
    border: '1px solid #dce2eb',
    borderRadius: '8px',
  },

  table: {
    width: '100%',
    minWidth: '2200px',
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