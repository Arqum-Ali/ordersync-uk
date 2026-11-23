
"use client";

import { useEffect, useState, FormEvent } from "react";

type Account = {
  account_label: string;
  email_label?: string | null;
  aliexpress_user_id: string;
  connection_status: string;
};

export default function CreateAliExpressOrderPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    productId: "",
    quantity: "1",
    skuAttr: "",

    firstName: "",
    lastName: "",

    address: "",
    address2: "",
    city: "",
    province: "",
    postcode: "",
    country: "GB",
    mobile: "",
    phoneCountry: "44",

    currency: "GBP",
    payment: "manual",
  });

  useEffect(() => {
    async function loadAccounts() {
      try {
        const response = await fetch("/api/aliexpress/accounts", {
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Could not load accounts");
        }

        const connected = (data.accounts || []).filter(
          (account: Account) =>
            account.connection_status === "connected"
        );

        setAccounts(connected);

        if (connected.length > 0) {
          setAccountId(connected[0].aliexpress_user_id);
        }
      } catch (err: any) {
        setError(err.message || "Could not load accounts");
      } finally {
        setLoadingAccounts(false);
      }
    }

    loadAccounts();
  }, []);

  function updateField(name: string, value: string) {
    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setResult(null);

    if (!accountId) {
      setError("Please select an AliExpress account.");
      return;
    }

    if (!/^\d+$/.test(form.productId)) {
      setError("Enter a valid AliExpress product ID.");
      return;
    }

    if (
      !Number.isInteger(Number(form.quantity)) ||
      Number(form.quantity) < 1
    ) {
      setError("Enter a valid product quantity.");
      return;
    }

    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const fullName = `${firstName} ${lastName}`.trim();

    if (!firstName || !lastName) {
      setError("Please enter both first name and last name.");
      return;
    }

    if (fullName.length < 2 || fullName.length > 32) {
      setError("Recipient name must be between 2 and 32 characters.");
      return;
    }

    if (!/^[A-Z]{2}$/.test(form.country.trim().toUpperCase())) {
      setError("Enter a valid two-letter country code.");
      return;
    }

    const confirmed = window.confirm(
      "IMPORTANT: This request may create a REAL AliExpress order. Continue?"
    );

    if (!confirmed) return;

    setSubmitting(true);

    try {
      const response = await fetch("/api/aliexpress/create-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accountId,
          productId: form.productId,
          quantity: Number(form.quantity),
          skuAttr: form.skuAttr,

          address: {
            first_name: firstName,
            last_name: lastName,
            full_name: fullName,

            address: form.address,
            address2: form.address2,
            city: form.city,
            province: form.province,
            country: form.country.trim().toUpperCase(),
            zip: form.postcode,

            mobile_no: form.mobile,
            phone_country: form.phoneCountry,
          },

          currency: form.currency,
          payment: form.payment,
        }),
      });

      const data = await response.json();

      setResult(data);

      if (!response.ok || !data.success) {
        setError(data.message || "AliExpress order creation failed.");
      }
    } catch (err: any) {
      setError(err.message || "Request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "40px auto",
        padding: 20,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>
        Create AliExpress Order
      </h1>

      <p style={{ color: "#666", marginBottom: 25 }}>
        Enter product and customer delivery information.
      </p>

      <form onSubmit={submitOrder}>
        <section style={sectionStyle}>
          <h2 style={headingStyle}>1. AliExpress Account</h2>

          {loadingAccounts ? (
            <p>Loading accounts...</p>
          ) : accounts.length === 0 ? (
            <p>No connected AliExpress accounts found.</p>
          ) : (
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              style={inputStyle}
              required
            >
              {accounts.map((account) => (
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
          )}
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>2. Product Details</h2>

          <Field label="AliExpress Product ID">
            <input
              value={form.productId}
              onChange={(e) =>
                updateField("productId", e.target.value)
              }
              style={inputStyle}
              placeholder="Enter product ID"
              required
            />
          </Field>

          <Field label="Quantity">
            <input
              type="number"
              min="1"
              step="1"
              value={form.quantity}
              onChange={(e) =>
                updateField("quantity", e.target.value)
              }
              style={inputStyle}
              required
            />
          </Field>

          <Field label="SKU Attribute / Variation">
            <input
              value={form.skuAttr}
              onChange={(e) =>
                updateField("skuAttr", e.target.value)
              }
              style={inputStyle}
              placeholder="Enter exact SKU attribute"
            />
          </Field>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>3. Customer Delivery Address</h2>

          <Field label="First Name">
            <input
              value={form.firstName}
              onChange={(e) =>
                updateField("firstName", e.target.value)
              }
              style={inputStyle}
              placeholder="Enter first name"
              required
            />
          </Field>

          <Field label="Last Name">
            <input
              value={form.lastName}
              onChange={(e) =>
                updateField("lastName", e.target.value)
              }
              style={inputStyle}
              placeholder="Enter last name"
              required
            />
          </Field>

          <Field label="Address">
            <input
              value={form.address}
              onChange={(e) =>
                updateField("address", e.target.value)
              }
              style={inputStyle}
              required
            />
          </Field>

          <Field label="Address Line 2">
            <input
              value={form.address2}
              onChange={(e) =>
                updateField("address2", e.target.value)
              }
              style={inputStyle}
            />
          </Field>

          <Field label="City">
            <input
              value={form.city}
              onChange={(e) =>
                updateField("city", e.target.value)
              }
              style={inputStyle}
              required
            />
          </Field>

          <Field label="Province / State">
            <input
              value={form.province}
              onChange={(e) =>
                updateField("province", e.target.value)
              }
              style={inputStyle}
              required
            />
          </Field>

          <Field label="Postcode">
            <input
              value={form.postcode}
              onChange={(e) =>
                updateField("postcode", e.target.value)
              }
              style={inputStyle}
              required
            />
          </Field>

          <Field label="Country Code">
            <input
              value={form.country}
              onChange={(e) =>
                updateField(
                  "country",
                  e.target.value.toUpperCase()
                )
              }
              style={inputStyle}
              maxLength={2}
              required
            />
          </Field>

          <Field label="Mobile Number">
            <input
              value={form.mobile}
              onChange={(e) =>
                updateField("mobile", e.target.value)
              }
              style={inputStyle}
            />
          </Field>

          <Field label="Phone Country Code">
            <input
              value={form.phoneCountry}
              onChange={(e) =>
                updateField("phoneCountry", e.target.value)
              }
              style={inputStyle}
            />
          </Field>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>4. Payment Settings</h2>

          <Field label="Payment Currency">
            <select
              value={form.currency}
              onChange={(e) =>
                updateField("currency", e.target.value)
              }
              style={inputStyle}
            >
              <option value="GBP">GBP</option>
              <option value="USD">USD</option>
            </select>
          </Field>

          <Field label="Payment Method">
            <select
              value={form.payment}
              onChange={(e) =>
                updateField("payment", e.target.value)
              }
              style={inputStyle}
            >
              <option value="manual">Manual Payment</option>
              <option value="automatic">
                Automatic Payment (DS authorization required)
              </option>
            </select>
          </Field>
        </section>

        {error && (
          <p
            style={{
              background: "#fee2e2",
              color: "#991b1b",
              padding: 12,
              borderRadius: 6,
            }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={
            submitting ||
            loadingAccounts ||
            accounts.length === 0
          }
          style={{
            width: "100%",
            padding: 15,
            background: submitting ? "#888" : "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 7,
            fontSize: 16,
            fontWeight: 700,
            cursor: submitting ? "not-allowed" : "pointer",
          }}
        >
          {submitting
            ? "Submitting..."
            : "Create AliExpress Order"}
        </button>
      </form>

      {result && (
        <section style={sectionStyle}>
          <h2 style={headingStyle}>AliExpress API Response</h2>

          <pre
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              background: "#f3f4f6",
              padding: 15,
              borderRadius: 7,
              fontSize: 13,
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        </section>
      )}
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 15 }}>
      <label
        style={{
          display: "block",
          fontWeight: 600,
          marginBottom: 7,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 9,
  padding: 20,
  marginBottom: 20,
};

const headingStyle: React.CSSProperties = {
  fontSize: 19,
  fontWeight: 700,
  marginBottom: 18,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 11,
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 15,
  boxSizing: "border-box",
};
