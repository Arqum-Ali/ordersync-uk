
import crypto from "crypto";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const API_URL = "https://api-sg.aliexpress.com/rest";
const API_PATH = "/ds/order/create";

const APP_KEY = process.env.ALIEXPRESS_APP_KEY!;
const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY!;

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function main() {
  if (!APP_KEY || !APP_SECRET || !SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Missing AliExpress or Supabase environment variables.");
  }

  console.log("\n=== AliExpress Order Creation Test ===\n");

  const accountId = await ask("AliExpress account ID: ");
  const productId = await ask("AliExpress product ID: ");
  const quantity = Number(await ask("Product quantity: "));

  const fullName = await ask("Customer full name: ");
  const address = await ask("Customer address: ");
  const address2 = await ask("Address line 2 (optional): ");
  const city = await ask("City: ");
  const province = await ask("Province: ");
  const postcode = await ask("Postcode: ");
  const country = (await ask("Country code (GB for UK): ")).toUpperCase();

  if (!/^\d+$/.test(accountId) || !/^\d+$/.test(productId)) {
    throw new Error("Account ID and product ID must contain digits only.");
  }

  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Quantity must be a positive whole number.");
  }

  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error("Country must be a two-letter country code.");
  }

  // Retrieve the selected account's access token from Supabase.
  const accountResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/aliexpress_accounts?select=access_token,aliexpress_user_id&aliexpress_user_id=eq.${encodeURIComponent(accountId)}`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      cache: "no-store",
    }
  );

  const accounts = await accountResponse.json();

  if (!accountResponse.ok || !Array.isArray(accounts) || !accounts.length) {
    throw new Error("Could not find the selected AliExpress account.");
  }

  const accessToken = accounts[0].access_token;

  if (!accessToken) {
    throw new Error("Access token is missing for this account.");
  }

  const orderRequest = {
    out_order_id: `TEST-${Date.now()}`,
    logistics_address: {
      full_name: fullName,
      address,
      ...(address2 ? { address2 } : {}),
      city,
      province,
      country,
      zip: postcode,
    },
    product_items: [
      {
        product_id: Number(productId),
        product_count: quantity,
        sku_attr: "",
      },
    ],
  };

  const requestParams: Record<string, string> = {
    app_key: APP_KEY,
    access_token: accessToken,
    sign_method: "sha256",
    timestamp: Date.now().toString(),
    param_place_order_request4_open_api_d_t_o: JSON.stringify(orderRequest),
    payment: JSON.stringify([
      {
        try_to_pay: "false",
        pay_currency: "GBP",
      },
    ]),
  };

  const sortedKeys = Object.keys(requestParams).sort();

  const signString =
    API_PATH +
    sortedKeys.map((key) => key + requestParams[key]).join("");

  const sign = crypto
    .createHmac("sha256", APP_SECRET)
    .update(signString, "utf8")
    .digest("hex")
    .toUpperCase();

  console.log("\nOrder details:");
  console.log(JSON.stringify({
    out_order_id: orderRequest.out_order_id,
    product_id: productId,
    quantity,
    country,
    payment: "Manual",
  }, null, 2));

  const confirmation = await ask(
    "\nWARNING: This may create a REAL AliExpress order. Type CREATE to submit it: "
  );

  if (confirmation !== "CREATE") {
    console.log("Cancelled. No order request was submitted.");
    return;
  }

  const response = await fetch(`${API_URL}${API_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      ...requestParams,
      sign,
    }).toString(),
  });

  const result = await response.json();

  console.log("\nHTTP Status:", response.status);
  console.log("\nAliExpress API Response:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("\nTEST FAILED:", error.message);
  process.exitCode = 1;
});
