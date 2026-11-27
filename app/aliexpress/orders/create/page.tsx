
"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import { parseVerifiedAddress } from "@/lib/address-parser";

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
  const [failed, setFailed] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [review, setReview] = useState(0);

  const stopRef = useRef(false);
  const pauseRef = useRef(false);
  const runningRef = useRef(false);

  // ==========================================
  // LOGGING
  // ==========================================

  function log(message: string) {
    setLogs(previous => [
      ...previous,
      `${new Date().toLocaleTimeString()} — ${message}`,
    ]);
  }

  // ==========================================
  // GOOGLE SHEETS API
  // ==========================================

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
  // LOAD CONNECTED ACCOUNTS AND SHEET TABS
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
          throw new Error(
            "Unable to load AliExpress accounts"
          );
        }

        const connected = (
          data.accounts || []
        ).filter(
          (account: Account) =>
            account.connection_status === "connected"
        );

        setAccounts(connected);

        if (connected.length > 0) {
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

        const data = await sheetsApi({
          action: "listTabs",
        });

        setTabs(data.tabs || []);

        if (data.tabs?.length) {

          const preferred = data.tabs.includes(
            "Betelbee Nov"
          )
            ? "Betelbee Nov"
            : data.tabs[0];

          setSheet(preferred);
        }

        log(
          `Loaded ${data.tabs.length} Google Sheet tabs`
        );

      } catch (error: any) {
        log(error.message);
      }
    }

    initialize();

  }, []);

  // ==========================================
  // PAUSE HANDLING
  // ==========================================

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
      !toDate
    ) {
      log(
        "Select account, sheet and date range."
      );
      return;
    }

    if (fromDate > toDate) {
      log("Invalid date range.");
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
    setFailed(0);
    setSkipped(0);
    setReview(0);

    try {

      // Automatically retrieve Google Sheet data

      log("Fetching orders from Google Sheets...");

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

      log(
        `Found ${orders.length} eligible orders`
      );

      if (!orders.length) {
        log("No eligible orders found.");
        return;
      }

      const confirmed = window.confirm(
        `Create ${orders.length} REAL AliExpress ` +
        `order request(s)?\n\n` +
        `Each request includes the original product ` +
        `and one fixed extra product.\n\n` +
        `Payment: Manual\nCurrency: GBP`
      );

      if (!confirmed || stopRef.current) {
        log("Automation cancelled.");
        return;
      }

      // ==========================================
      // PROCESS ORDERS ONE BY ONE
      // ==========================================

      for (const order of orders) {

        await waitWhilePaused();

        if (stopRef.current) break;

        let reservationId = "";
        let submitted = false;
        let orderIds: string[] = [];

        try {

          log(
            `Processing row ${order.row} — ` +
            `${order.orderNumber}`
          );

          // Column P only
          const address = parseVerifiedAddress(
            order.verifiedAddress
          );

          log(
            `Row ${order.row}: Address parsed successfully`
          );

          // Reserve order to prevent duplicate requests

          const reservation = await sheetsApi({
            action: "reserveOrder",
            sheet,
            orderNumber: order.orderNumber,
            expected: {
              productId: order.productId,
              skuAttr: order.skuAttr,
              quantity: order.quantity,
              verifiedAddress: order.verifiedAddress,
            },
          });

          reservationId = reservation.reservationId;

          await waitWhilePaused();

          if (stopRef.current) {

            await sheetsApi({
              action: "recordFailure",
              sheet,
              orderNumber: order.orderNumber,
              reservationId,
              confirmedRejected: true,
              message:
                "Stopped before order submission",
            });

            reservationId = "";
            break;
          }

          // ======================================
          // EXISTING ALIEXPRESS ORDER API
          // ======================================

          const payload = {
            accountId,

            // Column Q
            productId: order.productId,

            // Column E
            quantity: order.quantity,

            // Column R
            skuAttr: order.skuAttr,

            // Parsed Column P
            address,

            currency: "GBP",
            payment: "manual",
          };

          submitted = true;

          const response = await fetch(
            "/api/aliexpress/create-order",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            }
          );

          const data = await response.json();

          const returned = Array.isArray(data.orderIds)
            ? data.orderIds
            : data.orderIds != null
              ? [data.orderIds]
              : [];

          orderIds = returned
            .filter((id: unknown) =>
              typeof id === "string" ||
              (
                typeof id === "number" &&
                Number.isSafeInteger(id)
              )
            )
            .map(String)
            .filter(
              (id: string) => /^\d+$/.test(id)
            );

          // ======================================
          // HANDLE FAILED ORDERS
          // ======================================

          if (!response.ok || !data.success) {

            const preflightFailures = [
              "INPUT_VALIDATION",
              "ADDRESS_VALIDATION",
              "PAYMENT_VALIDATION",
              "ENVIRONMENT_CONFIGURATION",
              "SUPABASE_ACCOUNT_LOOKUP",
              "ACCOUNT_VALIDATION",
              "TOKEN_VALIDATION",
            ];

            const confirmedRejected =
              (
                preflightFailures.includes(
                  data.step
                ) ||
                data.confirmedRejected === true
              ) &&
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
                data.message ||
                "AliExpress rejected order",
            });

            reservationId = "";

            if (confirmedRejected) {
              setFailed(value => value + 1);
            } else {
              setReview(value => value + 1);
            }

            log(
              `Row ${order.row}: ` +
              `${data.message || "Order failed"}`
            );

            log(
              confirmedRejected
                ? "Skipped. Moving to next order."
                : "Review required. Moving to next order."
            );

            continue;
          }

          // ======================================
          // SUCCESSFUL ORDER
          // ======================================

          setCreated(value => value + 1);

          log(
            `Row ${order.row}: Order created successfully`
          );

          log(
            `Returned Order IDs: ` +
            `${orderIds.join(", ") || "Not returned"}`
          );

          // Save only when backend confirms the
          // original product-to-order-ID mapping.

          const originalOrderId = String(
            data.originalOrderId || ""
          );

          if (
            data.mappingVerified === true &&
            /^\d+$/.test(originalOrderId) &&
            orderIds.includes(originalOrderId)
          ) {

            const saved = await sheetsApi({
              action: "saveOrder",
              sheet,
              orderNumber: order.orderNumber,
              reservationId,
              productId: order.productId,
              originalOrderId,
              mappingVerified: true,
            });

            reservationId = "";

            log(
              `Original Order ID saved in ${saved.cell}`
            );

          } else {

            // Preserve IDs without incorrectly
            // saving the fixed extra product ID.

            await sheetsApi({
              action: "recordFailure",
              sheet,
              orderNumber: order.orderNumber,
              reservationId,
              uncertain: true,
              orderIds,
              message:
                "Order created successfully. " +
                "Original product Order ID requires " +
                "verification before saving Column G.",
            });

            reservationId = "";

            setReview(value => value + 1);

            log(
              "Order IDs saved in recovery log. " +
              "Column G pending verification."
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
                "Recovery log update failed. " +
                "Reservation remains blocked."
              );

              log(
                `Returned IDs: ${orderIds.join(", ")}`
              );
            }
          }

          if (submitted) {
            setReview(value => value + 1);
          } else {
            setFailed(value => value + 1);
          }

          log("Moving to next order.");

        } finally {

          setProcessed(value => value + 1);
        }
      }

      log(
        stopRef.current
          ? "Automation stopped safely."
          : "Automation completed."
      );

    } catch (error: any) {

      log(error.message);

    } finally {

      setRunning(false);
      setPaused(false);

      runningRef.current = false;
      pauseRef.current = false;
    }
  }

  // ==========================================
  // AUTOMATION CONTROLS
  // ==========================================

  function pauseAutomation() {

    pauseRef.current = true;
    setPaused(true);

    log(
      "Pause requested. Finishing current request."
    );
  }

  function resumeAutomation() {

    pauseRef.current = false;
    setPaused(false);

    log("Automation resumed.");
  }

  function stopAutomation() {

    stopRef.current = true;
    pauseRef.current = false;

    setPaused(false);

    log(
      "Stop requested. Finishing current request."
    );
  }

  // ==========================================
  // PAGE INTERFACE
  // ==========================================

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
        marginBottom: 10,
      }}>
        AliExpress Order Automation V1
      </h1>

      <p style={{
        color: "#666",
        marginBottom: 25,
      }}>
        Automatically create AliExpress orders
        using Google Sheets.
      </p>

      <section style={sectionStyle}>

        <h2 style={headingStyle}>
          Automation Settings
        </h2>

        <label>AliExpress Account</label>

        <select
          style={inputStyle}
          value={accountId}
          disabled={running}
          onChange={event =>
            setAccountId(event.target.value)
          }
        >

          <option value="">
            Select AliExpress account
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
          onChange={event =>
            setSheet(event.target.value)
          }
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
              onChange={event =>
                setFromDate(event.target.value)
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
              onChange={event =>
                setToDate(event.target.value)
              }
            />

          </div>

        </div>

        <div style={{
          background: "#f3f4f6",
          padding: 15,
          borderRadius: 8,
          marginBottom: 20,
          color: "#111827",
        }}>

          <p>Payment: Manual</p>
          <p>Currency: GBP</p>

          <p>
            Fixed extra product:
            Automatically included
          </p>

          <p>
            Existing AliExpress orders:
            Automatically skipped
          </p>

          <p>
            Address source: Column P only
          </p>

        </div>

        <label style={{
          display: "block",
          marginBottom: 20,
        }}>

          <input
            type="checkbox"
            checked={testMode}
            disabled={running}
            onChange={event =>
              setTestMode(event.target.checked)
            }
          />

          {" "}Test Mode — Process only one real order

        </label>

        <button
          style={{
            ...buttonStyle,
            width: "100%",
            background:
              running ? "#9ca3af" : "#2563eb",
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

        <h2 style={headingStyle}>
          Automation Progress
        </h2>

        <div style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 12,
        }}>

          <Stat label="Total" value={total}/>

          <Stat
            label="Processed"
            value={processed}
          />

          <Stat
            label="Created"
            value={created}
            color="#16a34a"
          />

          <Stat
            label="Failed"
            value={failed}
            color="#dc2626"
          />

          <Stat
            label="Skipped"
            value={skipped}
          />

          <Stat
            label="Needs Review"
            value={review}
            color="#d97706"
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

        <h2 style={headingStyle}>
          Live Automation Logs
        </h2>

        <pre style={{
          background: "#111827",
          color: "#ffffff",
          padding: 20,
          minHeight: 230,
          maxHeight: 500,
          overflow: "auto",
          borderRadius: 8,
          fontSize: 13,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
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
  color = "#111827",
}: {
  label: string;
  value: number;
  color?: string;
}) {

  return (

    <div style={{
      background: "#f3f4f6",
      padding: 15,
      borderRadius: 8,
      textAlign: "center",
    }}>

      <div style={{
        fontSize: 13,
        color: "#666",
      }}>
        {label}
      </div>

      <div style={{
        fontSize: 28,
        fontWeight: 700,
        color,
      }}>
        {value}
      </div>

    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 10,
  padding: 22,
  marginBottom: 22,
};

const headingStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  marginBottom: 20,
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
  padding: "12px 20px",
  color: "#ffffff",
  border: "none",
  borderRadius: 6,
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
