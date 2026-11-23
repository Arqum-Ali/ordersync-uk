
import Link from 'next/link';
import styles from '../orders.module.css';

export default function AliExpressOrderResultsPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>ALIEXPRESS INTEGRATION</div>

        <h1>Order Results</h1>

        <p className={styles.intro}>
          View tracking information and delivery details for your AliExpress orders.
        </p>

        <div className={styles.section}>
          <strong className={styles.sectionTitle}>Order Summary</strong>

          <div className={styles.dateGrid}>
            <div>
              <p className={styles.mutedText}>Total Orders</p>
              <h2>0</h2>
            </div>

            <div>
              <p className={styles.mutedText}>Delivered</p>
              <h2>0</h2>
            </div>

            <div>
              <p className={styles.mutedText}>In Transit</p>
              <h2>0</h2>
            </div>

            <div>
              <p className={styles.mutedText}>Tracking Available</p>
              <h2>0</h2>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <strong className={styles.sectionTitle}>Order Details</strong>

          <div className={styles.tableWrap}>
            <table className={styles.resultsTable}>
              <thead>
                <tr>
                  <th>AliExpress Order ID</th>
                  <th>Tracking Number</th>
                  <th>Courier</th>
                  <th>Delivery Status</th>
                  <th>Delivery Date</th>
                </tr>
              </thead>

              <tbody>
                <tr>
                  <td colSpan={5}>
                    <div className={styles.emptyState}>
                      No order results available yet.
                      <br />
                      Upload your Excel file and retrieve orders to see the data here.
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

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
