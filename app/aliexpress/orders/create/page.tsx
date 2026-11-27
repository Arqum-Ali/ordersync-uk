
"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  parseVerifiedAddress
} from "@/lib/address-parser";

type Account = {
  account_label: string;
  email_label?: string;
  aliexpress_user_id: string;
  connection_status: string;
};

type Order = {
  row: number;
  orderNumber: string;
  date: string;
  quantity: number;
  productName: string;
  productId: string;
  skuAttr: string;
  verifiedAddress: string;
};

export default function OrderAutomationPage() {

  const [accounts, setAccounts] =
    useState<Account[]>([]);

  const [accountId, setAccountId] = useState("");
  const [tabs, setTabs] = useState<string[]>([]);
  const [sheet, setSheet] = useState("");

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [testMode, setTestMode] = useState(true);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);

  const [logs, setLogs] = useState<string[]>([]);

  const [total, setTotal] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [created, setCreated] = useState(0);
  const [saved, setSaved] = useState(0);
  const [failed, setFailed] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [review, setReview] = useState(0);
  const [totalPrice, setTotalPrice] = useState(0);

  const runningRef = useRef(false);
  const stopRef = useRef(false);
  const pauseRef = useRef(false);

  function log(message: string) {

    setLogs(old => [
      ...old,
      `${new Date().toLocaleTimeString()} — ${message}`,
    ]);
  }

  async function sheetsApi(body: object) {

    const response = await fetch(
      "/api/google-sheets",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(
        data.message || "Google Sheets request failed"
      );
    }

    return data;
  }

  // ==========================================
  // LOAD ACCOUNTS AND SHEET TABS
  // ==========================================

  useEffect(() => {

    async function initialize() {

      try {

        const response = await fetch(
          "/api/aliexpress/accounts",
          { cache: "no-store" }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error("Unable to load accounts");
        }

        const connected = (
          data.accounts || []
        ).filter(
          (a: Account) =>
            a.connection_status === "connected"
        );

        setAccounts(connected);

        if (connected.length) {
          setAccountId(
            connected[0].aliexpress_user_id
          );
        }

        log(
          `Loaded ${connected.length} connected accounts`
        );

      } catch (error: any) {
        log(error.message);
      }

      try {

        const result = await sheetsApi({
          action: "listTabs",
        });

        setTabs(result.tabs || []);

        if (result.tabs?.length) {

          setSheet(
            result.tabs.includes("Betelbee Nov")
              ? "Betelbee Nov"
              : result.tabs[0]
          );
        }

        log(
          `Loaded ${result.tabs.length} Google Sheet tabs`
        );

      } catch (error: any) {
        log(error.message);
      }
    }

    initialize();

  }, []);

  async function waitWhilePaused() {

    while (
      pauseRef.current &&
      !stopRef.current
    ) {
      await new Promise(resolve =>
        setTimeout(resolve, 500)
      );
    }
  }

  // ==========================================
  // START AUTOMATION
  // ==========================================

  async function startAutomation() {

    if (runningRef.current) return;

    if (
      !accountId ||
      !sheet ||
      !fromDate ||
      !toDate ||
      fromDate > toDate
    ) {

      log("Select valid account, sheet and dates");
      return;
    }

    runningRef.current = true;
    stopRef.current = false;
    pauseRef.current = false;

    setRunning(true);
    setPaused(false);

    setLogs([]);
    setTotal(0);
    setProcessed(0);
    setCreated(0);
    setSaved(0);
    setFailed(0);
    setSkipped(0);
    setReview(0);
    setTotalPrice(0);

    try {

      log("Loading matching orders...");

      const result = await sheetsApi({
        action: "getOrders",
        sheet,
        fromDate,
        toDate,
      });

      setSkipped(result.skippedCount || 0);

      for (const item of result.skipped || []) {

        log(
          `Row ${item.row}: Skipped — ${item.reason}`
        );
      }

      const orders: Order[] = testMode
        ? result.orders.slice(0, 1)
        : result.orders;

      setTotal(orders.length);

      log(`Found ${orders.length} eligible orders`);

      if (!orders.length) return;

      const confirmed = window.confirm(
        `Create ${orders.length} real AliExpress ` +
        `order request(s)?\n\n` +
        `Original product + fixed extra product.\n` +
        `Payment: Manual\nCurrency: GBP`
      );

      if (!confirmed || stopRef.current) {
        log("Automation cancelled");
        return;
      }

      for (const order of orders) {

        await waitWhilePaused();

        if (stopRef.current) break;

        let reservationId = "";
        let submitted = false;
        let orderIds: string[] = [];

        try {

          log(
            `Processing row ${order.row} — ` +
            order.orderNumber
          );

          const address = parseVerifiedAddress(
            order.verifiedAddress
          );

          // Empty SKU Attr does not skip the order.

          const skuAttr = String(
            order.skuAttr || ""
          ).trim();

          log(
            skuAttr
              ? `Row ${order.row}: SKU Attr available`
              : `Row ${order.row}: Empty SKU Attr — continuing`
          );

          const reservation = await sheetsApi({
            action: "reserveOrder",
            sheet,
            orderNumber: order.orderNumber,
            expected: {
              productId: order.productId,
              quantity: order.quantity,
              verifiedAddress: order.verifiedAddress,
              skuAttr,
            },
          });

          reservationId =
            reservation.reservationId;

          await waitWhilePaused();

          if (stopRef.current) {

            await sheetsApi({
              action: "recordFailure",
              sheet,
              orderNumber: order.orderNumber,
              reservationId,
              confirmedRejected: true,
              message: "Stopped before submission",
            });

            reservationId = "";
            break;
          }

          submitted = true;

          const response = await fetch(
            "/api/aliexpress/create-order",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                accountId,
                productId: order.productId,
                quantity: order.quantity,
                skuAttr,
                address,
                currency: "GBP",
                payment: "manual",
              }),
            }
          );

          const data = await response.json();

          orderIds = Array.isArray(data.orderIds)
            ? data.orderIds
                .filter(
                  (id: unknown) =>
                    typeof id === "string" ||
                    (
                      typeof id === "number" &&
                      Number.isSafeInteger(id)
                    )
                )
                .map(String)
                .filter(
                  (id: string) => /^\d+$/.test(id)
                )
            : [];

          // ======================================
          // FAILED ORDER
          // ======================================

          if (!response.ok || !data.success) {

            const confirmedRejected =
              data.confirmedRejected === true &&
              orderIds.length === 0;

            await sheetsApi({
              action: "recordFailure",
              sheet,
              orderNumber: order.orderNumber,
              reservationId,
              confirmedRejected,
              uncertain: !confirmedRejected,
              orderIds,
              message:
                data.message || "Order failed",
            });

            reservationId = "";

            if (confirmedRejected) {
              setFailed(v => v + 1);
            } else {
              setReview(v => v + 1);
            }

            log(
              `Row ${order.row}: ` +
              (data.message || "Order failed")
            );

            log("Moving to next order");

            continue;
          }

          // ======================================
          // ORDER CREATED
          // ======================================

          setCreated(v => v + 1);

          log(
            `Row ${order.row}: Order created`
          );

          log(
            `Returned IDs: ${orderIds.join(", ")}`
          );

          const originalOrderId = String(
            data.originalOrderId || ""
          );

          const price = data.originalPrice;

          // Verify both fields before saving.

          if (
            data.mappingVerified === true &&
            orderIds.includes(originalOrderId) &&
            typeof price === "number" &&
            Number.isFinite(price) &&
            price >= 0 &&
            data.priceCurrency === "GBP"
          ) {

            const updated = await sheetsApi({
              action: "saveOrder",
              sheet,
              orderNumber: order.orderNumber,
              reservationId,
              productId: order.productId,
              originalOrderId,
              originalPrice: price,
              priceCurrency: "GBP",
              mappingVerified: true,
            });

            reservationId = "";

            setSaved(v => v + 1);
            setTotalPrice(v => v + price);

            log(
              `Row ${order.row}: Original Order ID ` +
              originalOrderId
            );

            log(
              `Row ${order.row}: Price £${price.toFixed(2)}`
            );

            log(
              `Updated ${updated.cell} and ` +
              `${updated.priceCell} successfully`
            );

          } else {

            await sheetsApi({
              action: "recordFailure",
              sheet,
              orderNumber: order.orderNumber,
              reservationId,
              uncertain: true,
              orderIds,
              message:
                "Order created but ID or price verification pending",
            });

            reservationId = "";

            setReview(v => v + 1);

            log(
              `Row ${order.row}: Verification pending. ` +
              "IDs saved in recovery log."
            );
          }

        } catch (error: any) {

          log(
            `Row ${order.row}: ${error.message}`
          );

          if (reservationId) {

            try {

              await sheetsApi({
                action: "recordFailure",
                sheet,
                orderNumber: order.orderNumber,
                reservationId,
                confirmedRejected: !submitted,
                uncertain: submitted,
                orderIds,
                message: error.message,
              });

            } catch {

              log(
                "Recovery update failed. " +
                "Reservation remains blocked."
              );

              log(
                `Returned IDs: ${orderIds.join(", ")}`
              );
            }
          }

          if (submitted) {
            setReview(v => v + 1);
          } else {
            setFailed(v => v + 1);
          }

        } finally {

          setProcessed(v => v + 1);
        }
      }

      log(
        stopRef.current
          ? "Automation stopped"
          : "Automation completed"
      );

    } catch (error: any) {

      log(error.message);

    } finally {

      runningRef.current = false;
      pauseRef.current = false;

      setRunning(false);
      setPaused(false);
    }
  }

  function pauseAutomation() {

    pauseRef.current = true;
    setPaused(true);
    log("Pause requested");
  }

  function resumeAutomation() {

    pauseRef.current = false;
    setPaused(false);
    log("Automation resumed");
  }

  function stopAutomation() {

    stopRef.current = true;
    pauseRef.current = false;
    setPaused(false);
    log("Stop requested");
  }

  return (

    <main style={{
      maxWidth: 1100,
      margin: "40px auto",
      padding: 20,
      fontFamily: "Arial, sans-serif",
    }}>

      <h1 style={{
        fontSize: 30,
        fontWeight: 700,
      }}>
        AliExpress Order Automation V2
      </h1>

      <p>
        Optional SKU Attr • Automatic Order ID
        and Price Saving
      </p>

      <section style={sectionStyle}>

        <h2>Automation Settings</h2>

        <label>AliExpress Account</label>

        <select
          style={inputStyle}
          value={accountId}
          disabled={running}
          onChange={e =>
            setAccountId(e.target.value)
          }
        >

          <option value="">
            Select account
          </option>

          {accounts.map(account => (

            <option
              key={account.aliexpress_user_id}
              value={account.aliexpress_user_id}
            >
              {account.email_label ||
                account.account_label ||
                account.aliexpress_user_id}
            </option>

          ))}

        </select>

        <label>Google Sheet</label>

        <select
          style={inputStyle}
          value={sheet}
          disabled={running}
          onChange={e => setSheet(e.target.value)}
        >

          <option value="">
            Select Google Sheet
          </option>

          {tabs.map(tab => (

            <option key={tab} value={tab}>
              {tab}
            </option>

          ))}

        </select>

        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 15,
        }}>

          <div>

            <label>From Date</label>

            <input
              type="date"
              style={inputStyle}
              value={fromDate}
              disabled={running}
              onChange={e =>
                setFromDate(e.target.value)
              }
            />

          </div>

          <div>

            <label>To Date</label>

            <input
              type="date"
              style={inputStyle}
              value={toDate}
              disabled={running}
              onChange={e =>
                setToDate(e.target.value)
              }
            />

          </div>

        </div>

        <div style={{
          background: "#f3f4f6",
          color: "#111827",
          borderRadius: 8,
          padding: 15,
          marginBottom: 20,
        }}>

          <p>Payment: Manual</p>

          <p>Currency: GBP</p>

          <p>SKU Attr: Optional</p>

          <p>Address source: Column P</p>

          <p>Order ID output: Column G</p>

          <p>Price output: Column H</p>

          <p>Extra product: Automatically included</p>

        </div>

        <label>

          <input
            type="checkbox"
            checked={testMode}
            disabled={running}
            onChange={e =>
              setTestMode(e.target.checked)
            }
          />

          {" "}Test Mode — Process one real order

        </label>

        <button
          style={{
            ...buttonStyle,
            background: "#2563eb",
            width: "100%",
            marginTop: 20,
          }}
          disabled={
            running ||
            !accountId ||
            !sheet ||
            !fromDate ||
            !toDate
          }
          onClick={startAutomation}
        >

          {running
            ? "Automation Running..."
            : "Start Automation"}

        </button>

        <div style={{
          display: "flex",
          gap: 10,
          marginTop: 15,
        }}>

          <button
            style={{
              ...buttonStyle,
              background: "#d97706",
            }}
            disabled={!running || paused}
            onClick={pauseAutomation}
          >
            Pause
          </button>

          <button
            style={{
              ...buttonStyle,
              background: "#16a34a",
            }}
            disabled={!running || !paused}
            onClick={resumeAutomation}
          >
            Resume
          </button>

          <button
            style={{
              ...buttonStyle,
              background: "#dc2626",
            }}
            disabled={!running}
            onClick={stopAutomation}
          >
            Stop Safely
          </button>

        </div>

      </section>

      <section style={sectionStyle}>

        <h2>Automation Progress</h2>

        <div style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(120px,1fr))",
          gap: 12,
        }}>

          <Stat label="Total" value={total}/>

          <Stat label="Processed" value={processed}/>

          <Stat label="Created" value={created}/>

          <Stat label="Saved to Sheet" value={saved}/>

          <Stat label="Failed" value={failed}/>

          <Stat label="Skipped" value={skipped}/>

          <Stat label="Needs Review" value={review}/>

          <Stat
            label="Verified Order Total"
            value={`£${totalPrice.toFixed(2)}`}
          />

        </div>

        <progress
          value={processed}
          max={total || 1}
          style={{
            width: "100%",
            height: 20,
            marginTop: 20,
          }}
        />

      </section>

      <section style={sectionStyle}>

        <h2>Live Automation Logs</h2>

        <pre style={{
          background: "#111827",
          color: "#ffffff",
          padding: 20,
          borderRadius: 8,
          minHeight: 250,
          maxHeight: 500,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontSize: 13,
        }}>

          {logs.join("\n") ||
            "No automation started."}

        </pre>

      </section>

    </main>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {

  return (

    <div style={{
      background: "#f3f4f6",
      color: "#111827",
      borderRadius: 8,
      padding: 15,
      textAlign: "center",
    }}>

      <div style={{ fontSize: 13 }}>
        {label}
      </div>

      <div style={{
        fontSize: 25,
        fontWeight: 700,
      }}>
        {value}
      </div>

    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  padding: 22,
  marginTop: 20,
  marginBottom: 20,
  border: "1px solid #ddd",
  borderRadius: 10,
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: 12,
  marginTop: 7,
  marginBottom: 20,
  border: "1px solid #ccc",
  borderRadius: 6,
  boxSizing: "border-box",
};

const buttonStyle: React.CSSProperties = {
  border: "none",
  padding: "12px 20px",
  borderRadius: 6,
  color: "#ffffff",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
