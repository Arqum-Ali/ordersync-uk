
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

const VERSION = "V2.2";

const API_URL = "https://api-sg.aliexpress.com/sync";

const FALLBACK_PRODUCTS = [
  {
    name: "Product A - Black",
    productId: "1005013367794536",
    skuAttr: "5:200003528#1PCS;14:10#Black",
  },
  {
    name: "Product B - 1pcs With Box",
    productId: "1005012432973680",
    skuAttr: "14:193#1pcs With Box",
  },
];

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function sleep(ms: number) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

function validId(value: unknown): string {

  if (
    typeof value === "number" &&
    !Number.isSafeInteger(value)
  ) {
    return "";
  }

  const text = String(value ?? "").trim();

  return /^\d+$/.test(text) ? text : "";
}

function extractIds(result: any): string[] {

  const value =
    result?.order_list?.number ??
    result?.order_list ??
    [];

  const list = Array.isArray(value)
    ? value
    : [value];

  return [...new Set(
    list.map(validId).filter(Boolean)
  )];
}

// ==========================================
// EXTRACT DETAILED API ERRORS
// ==========================================

function getError(data: any, result: any): string {

  const errors = [
    result?.error_code,
    result?.error_msg,
    result?.error_message,
    result?.errorMessage,
    result?.message,
    result?.msg,
    result?.code,

    data?.error_response?.code,
    data?.error_response?.msg,
    data?.error_response?.sub_code,
    data?.error_response?.sub_msg,

    data?.error_code,
    data?.error_message,
    data?.errorMessage,
    data?.message,
    data?.msg,
    data?.code,

    data?.aliexpress_ds_order_create_response
      ?.error_msg,

    data?.aliexpress_ds_order_create_response
      ?.error_code,
  ];

  const messages = errors
    .filter(value =>
      typeof value === "string" ||
      typeof value === "number"
    )
    .map(String)
    .filter(Boolean);

  return messages.length
    ? [...new Set(messages)].join(" | ")
    : "AliExpress request failed — check terminal";
}

// ==========================================
// SAFE DEBUGGING
// ==========================================

function redactDebug(value: any): any {

  if (Array.isArray(value)) {
    return value.map(redactDebug);
  }

  if (value && typeof value === "object") {

    const output: Record<string, any> = {};

    for (
      const [key, entry] of Object.entries(value)
    ) {

      if (
        /token|secret|password|session|address|mobile|phone|contact_person|full_name|first_name|last_name|recipient|email|zip|postcode|buyer_name|sign/i
          .test(key)
      ) {

        output[key] = "[REDACTED]";

      } else {

        output[key] = redactDebug(entry);
      }
    }

    return output;
  }

  return value;
}

function debugLog(label: string, data: any) {

  if (process.env.NODE_ENV !== "production") {

    console.log(
      label,
      JSON.stringify(redactDebug(data), null, 2)
    );
  }
}

// ==========================================
// SIGNED ALIEXPRESS API REQUEST
// ==========================================

async function callAliExpress(
  method: string,
  businessParams: Record<string, string>,
  accessToken: string
) {

  const appKey =
    process.env.ALIEXPRESS_APP_KEY;

  const appSecret =
    process.env.ALIEXPRESS_APP_SECRET;

  if (!appKey || !appSecret) {

    throw new Error(
      "AliExpress environment variables missing"
    );
  }

  const commonParams: Record<string, string> = {
    app_key: appKey,
    v: "2.0",
    timestamp: Date.now().toString(),
    method,
    format: "json",
    session: accessToken,
    partner_id: "iop-sdk-java-20181207",
    sign_method: "sha256",
    simplify: "true",
  };

  const allParams = {
    ...commonParams,
    ...businessParams,
  };

  const signString = Object.keys(allParams)
    .sort()
    .map(key => key + allParams[key])
    .join("");

  const sign = crypto
    .createHmac("sha256", appSecret)
    .update(signString, "utf8")
    .digest("hex")
    .toUpperCase();

  const query = new URLSearchParams({
    ...commonParams,
    sign,
  });

  const response = await fetch(
    `${API_URL}?${query.toString()}`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded;charset=UTF-8",
      },

      body: new URLSearchParams(
        businessParams
      ).toString(),

      cache: "no-store",
    }
  );

  const raw = await response.text();

  // Preserve large numeric order IDs.

  const safeJson = raw.replace(
    /("(?:order_id|product_id|id|child_id)"\s*:\s*)(\d{16,})(?=\s*[,}])/g,
    '$1"$2"'
  ).replace(
    /("(?:order_list|number)"\s*:\s*\[)([\d,\s]+)(\])/g,
    (_, start, values, end) =>
      start +
      values.replace(
        /\d+/g,
        (v: string) => `"${v}"`
      ) +
      end
  );

  let data: any;

  try {

    data = JSON.parse(safeJson);

  } catch {

    throw new Error(
      `AliExpress returned invalid JSON. HTTP ${response.status}`
    );
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

// ==========================================
// GET CONNECTED ACCOUNT
// ==========================================

async function getAccount(accountId: string) {

  const url = process.env.SUPABASE_URL;

  const key =
    process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {

    throw new Error(
      "Supabase configuration missing"
    );
  }

  const response = await fetch(
    `${url}/rest/v1/aliexpress_accounts` +
    `?select=access_token,access_token_expires_at,connection_status` +
    `&aliexpress_user_id=eq.${encodeURIComponent(accountId)}` +
    `&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },

      cache: "no-store",
    }
  );

  if (!response.ok) {

    throw new Error(
      "Could not retrieve AliExpress account"
    );
  }

  const accounts = await response.json();

  const account = accounts[0];

  if (
    !account ||
    account.connection_status !== "connected"
  ) {

    throw new Error(
      "Selected AliExpress account is not connected"
    );
  }

  if (!account.access_token) {

    throw new Error(
      "AliExpress access token missing"
    );
  }

  if (
    account.access_token_expires_at &&
    Date.now() >= new Date(
      account.access_token_expires_at
    ).getTime()
  ) {

    throw new Error(
      "AliExpress access token expired"
    );
  }

  return account;
}

// ==========================================
// GET ORDER DETAILS
// ==========================================

async function getOrderDetails(
  orderId: string,
  accessToken: string
) {

  const response = await callAliExpress(
    "aliexpress.trade.ds.order.get",

    {
      single_order_query: JSON.stringify({
        order_id: orderId,
      }),
    },

    accessToken
  );

  debugLog(
    `ORDER DETAILS RESPONSE — ${orderId}:`,
    response.data
  );

  if (
    !response.ok ||
    response.data.error_response
  ) {

    throw new Error(
      getError(
        response.data,
        response.data.result
      )
    );
  }

  const result =
    response.data
      .aliexpress_trade_ds_order_get_response
      ?.result ??
    response.data.result;

  if (!result || typeof result !== "object") {

    throw new Error(
      "Order details response unavailable"
    );
  }

  return result;
}

// ==========================================
// EXTRACT CHILD ORDERS
// ==========================================

function getChildOrders(result: any): any[] {

  const children =
    result?.child_order_list
      ?.aeop_child_order_info ??

    result?.child_order_list
      ?.ae_child_order_info ??

    result?.child_order_list ??

    [];

  if (Array.isArray(children)) {
    return children;
  }

  if (children && children.product_id) {
    return [children];
  }

  return [];
}

// ==========================================
// VERIFY ORIGINAL ORDER ID AND GBP PRICE
// ==========================================

async function verifyOriginalOrder(
  orderIds: string[],
  productId: string,
  quantity: number,
  currency: string,
  accessToken: string
) {

  // Only read-only requests are retried.

  for (let attempt = 0; attempt < 3; attempt++) {

    if (attempt > 0) {

      await sleep(attempt * 2000);
    }

    const matches: {
      originalOrderId: string;
      originalPrice: number;
      priceCurrency: string;
    }[] = [];

    let allResolved = true;

    for (const orderId of orderIds) {

      try {

        const detail = await getOrderDetails(
          orderId,
          accessToken
        );

        const children = getChildOrders(detail);

        if (!children.length) {

          allResolved = false;
          continue;
        }

        const matching = children.filter(
          child =>
            validId(child.product_id) === productId
        );

        if (!matching.length) {
          continue;
        }

        // Exclude any combined original + addon total.

        if (matching.length !== children.length) {

          allResolved = false;
          continue;
        }

        const totalQuantity = matching.reduce(
          (sum, child) =>
            sum + Number(child.product_count),
          0
        );

        if (totalQuantity !== quantity) {

          allResolved = false;
          continue;
        }

        const amount = detail.order_amount;

        const amountText = String(
          amount?.amount ?? ""
        );

        const amountCurrency = String(
          amount?.currency_code ?? ""
        ).toUpperCase();

        if (
          !/^\d+(\.\d+)?$/.test(amountText) ||
          amountCurrency !== currency
        ) {

          allResolved = false;
          continue;
        }

        const price = Number(amountText);

        if (
          !Number.isFinite(price) ||
          price < 0
        ) {

          allResolved = false;
          continue;
        }

        matches.push({
          originalOrderId: orderId,
          originalPrice: price,
          priceCurrency: amountCurrency,
        });

      } catch {

        allResolved = false;

        console.error(
          "Order details verification failed:",
          orderId
        );
      }
    }

    if (
      allResolved &&
      matches.length === 1
    ) {

      console.log(
        "ORIGINAL ORDER VERIFIED:",
        matches[0]
      );

      return {
        mappingVerified: true,
        ...matches[0],
      };
    }
  }

  return {
    mappingVerified: false,

    originalOrderId: null,

    originalPrice: null,

    priceCurrency: null,

    verificationMessage:
      "Order created but original ID or GBP price could not be verified",
  };
}

// ==========================================
// MAIN ORDER CREATION ENDPOINT
// ==========================================

export async function POST(req: NextRequest) {

  let submitted = false;

  let returnedOrderIds: string[] = [];

  try {

    const body = await req.json();

    const accountId = validId(body.accountId);

    const productId = validId(body.productId);

    const quantity = Number(body.quantity);

    const address = body.address || {};

    // ========================================
    // SKU ATTR IS OPTIONAL
    // ========================================

    const skuAttr = String(
      body.skuAttr ?? ""
    ).trim();

    const currency = String(
      body.currency || "GBP"
    ).toUpperCase();

    const firstName = String(
      address.first_name || ""
    ).trim();

    const lastName = String(
      address.last_name || ""
    ).trim();

    const fullName =
      [firstName, lastName]
        .filter(Boolean)
        .join(" ") ||

      String(address.full_name || "").trim();

    // ========================================
    // INPUT VALIDATION
    // ========================================

    if (
      !accountId ||
      !productId ||
      !Number.isSafeInteger(Number(productId)) ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      currency !== "GBP"
    ) {

      return NextResponse.json(
        {
          success: false,
          confirmedRejected: true,
          step: "INPUT_VALIDATION",

          message:
            "Invalid account, product ID, quantity or currency",
        },

        { status: 400 }
      );
    }

    // ========================================
    // ADDRESS VALIDATION
    // ========================================

    if (
      fullName.length < 2 ||
      fullName.length > 32 ||
      !String(address.address || "").trim() ||
      !String(address.city || "").trim() ||
      !String(address.province || "").trim() ||
      !String(address.zip || "").trim() ||
      address.country !== "GB" ||
      !/^\d{10}$/.test(
        String(address.mobile_no || "")
      )
    ) {

      return NextResponse.json(
        {
          success: false,
          confirmedRejected: true,
          step: "ADDRESS_VALIDATION",
          message: "Invalid delivery address",
        },

        { status: 400 }
      );
    }

    const account = await getAccount(accountId);

    // ========================================
    // SHIPPING ADDRESS
    // ========================================

    const logisticsAddress = {

      zip: String(address.zip)
        .replace(/\s+/g, "")
        .toUpperCase(),

      country: "GB",

      address: String(address.address),

      address2: String(address.address2 || ""),

      city: String(address.city),

      contact_person: fullName,

      mobile_no: String(address.mobile_no),

      phone_country: "+44",

      full_name: fullName,

      province: String(address.province),
    };

    // ========================================
    // ORIGINAL PRODUCT — V2.2 FIX
    // ========================================

    const customerProduct = {

      product_id: Number(productId),

      product_count: quantity,

      // IMPORTANT:
      // If SKU Attr exists, include it.
      // If empty, do NOT send sku_attr at all.

      ...(skuAttr
        ? { sku_attr: skuAttr }
        : {}),

      logistics_service_name: String(
        body.logisticsServiceName || ""
      ),

      order_memo: String(
        body.orderMemo || ""
      ),
    };

    // ========================================
    // MANUAL PAYMENT
    // ========================================

    const dsExtendRequest = {

      payment: {
        pay_currency: currency,
        try_to_pay: "false",
      },

      promotion: {
        promotion_code: "",
      },
    };

    // ========================================
    // CREATE ORIGINAL + EXTRA PRODUCT
    // ========================================

    async function createOrder(
      addon: typeof FALLBACK_PRODUCTS[number]
    ) {

      const productItems = [

        customerProduct,

        {
          product_id: Number(addon.productId),

          product_count: 1,

          sku_attr: addon.skuAttr,

          logistics_service_name: "",

          order_memo: "",
        },
      ];

      const orderRequest = {

        product_items: productItems,

        logistics_address: logisticsAddress,
      };

      console.log(
        "========================================"
      );

      console.log(
        "ALIEXPRESS ORDER AUTOMATION", VERSION
      );

      console.log(
        "Product ID:", productId
      );

      console.log(
        "SKU Attr:",
        skuAttr || "[OMITTED FROM REQUEST]"
      );

      console.log(
        "SKU parameter included:",
        Object.prototype.hasOwnProperty.call(
          customerProduct,
          "sku_attr"
        )
      );

      console.log("Quantity:", quantity);

      console.log(
        "Extra product:", addon.name
      );

      console.log(
        "Payment: Manual | Currency:", currency
      );

      debugLog(
        "PRODUCT ITEMS:",
        productItems
      );

      submitted = true;

      const response = await callAliExpress(

        "aliexpress.ds.order.create",

        {

          ds_extend_request:
            JSON.stringify(dsExtendRequest),

          param_place_order_request4_open_api_d_t_o:
            JSON.stringify(orderRequest),
        },

        account.access_token
      );

      console.log(
        "ALIEXPRESS HTTP STATUS:",
        response.status
      );

      debugLog(
        "ALIEXPRESS RAW RESPONSE:",
        response.data
      );

      const result =

        response.data
          .aliexpress_ds_order_create_response
          ?.result ??

        response.data.result ??

        response.data;

      debugLog(
        "ALIEXPRESS EXTRACTED RESULT:",
        result
      );

      const orderIds = extractIds(result);

      returnedOrderIds = [...new Set([
        ...returnedOrderIds,
        ...orderIds,
      ])];

      const success =
        response.ok &&
        !response.data.error_response &&
        result.is_success === true;

      const message = success

        ? "Order created successfully"

        : getError(response.data, result);

      const stockError =
        /out of stock|sold out|insufficient stock|inventory insufficient|stock not enough/i
          .test(message);

      const skuError =
        /SKU_NOT_EXIST|SKU_NOT_EXIST_SUPER_LINK|INVALID_SKU/i
          .test(message);

      const explicitRejection =
        response.ok &&
        result.is_success === false &&
        orderIds.length === 0;

      console.log(
        "ORDER SUCCESS:", success
      );

      console.log(
        "ORDER IDS:", orderIds
      );

      console.log(
        "API MESSAGE:", message
      );

      console.log(
        "STOCK ERROR:", stockError
      );

      console.log(
        "SKU ERROR:", skuError
      );

      console.log(
        "EXPLICIT REJECTION:",
        explicitRejection
      );

      return {

        success,

        orderIds,

        message,

        stockError,

        skuError,

        explicitRejection,

        addon,

        productItems,

        apiData: response.data,

        httpStatus: response.status,
      };
    }

    // ========================================
    // FIRST ATTEMPT — PRODUCT A
    // ========================================

    let result = await createOrder(
      FALLBACK_PRODUCTS[0]
    );

    let fallbackUsed = false;

    const allowFallback =
      process.env.ALIEXPRESS_ATOMIC_STOCK_FALLBACK
      === "true";

    // ========================================
    // PRODUCT B FALLBACK
    // ========================================

    if (
      !result.success &&
      result.explicitRejection &&
      result.stockError &&
      !result.skuError &&
      allowFallback &&
      returnedOrderIds.length === 0
    ) {

      console.log(
        "Product A stock error — trying Product B"
      );

      result = await createOrder(
        FALLBACK_PRODUCTS[1]
      );

      fallbackUsed = true;
    }

    // ========================================
    // FAILED ORDER
    // ========================================

    if (!result.success) {

      debugLog(
        "ALIEXPRESS FAILED ORDER RESPONSE:",
        result.apiData
      );

      return NextResponse.json(
        {
          success: false,

          version: VERSION,

          confirmedRejected: false,

          uncertain: true,

          step: result.skuError
            ? "SKU_REJECTED"
            : "ORDER_FAILED",

          message: result.message,

          orderIds: returnedOrderIds,

          fallbackUsed,

          stockError: result.stockError,

          skuError: result.skuError,

          explicitRejection:
            result.explicitRejection,

          debug: {

            version: VERSION,

            productId,

            skuAttr,

            skuAttrIncluded:
              Object.prototype.hasOwnProperty.call(
                customerProduct,
                "sku_attr"
              ),

            quantity,

            selectedAddon: result.addon.name,

            httpStatus: result.httpStatus,
          },
        },

        { status: 502 }
      );
    }

    // ========================================
    // ORDER SUCCESSFULLY CREATED
    // ========================================

    console.log(
      "ALIEXPRESS ORDER CREATED"
    );

    console.log(
      "Returned Order IDs:",
      returnedOrderIds
    );

    console.log(
      "Retrieving original Order ID and GBP price..."
    );

    const verified = result.orderIds.length

      ? await verifyOriginalOrder(

          result.orderIds,

          productId,

          quantity,

          currency,

          account.access_token
        )

      : {

          mappingVerified: false,

          originalOrderId: null,

          originalPrice: null,

          priceCurrency: null,
        };

    // ========================================
    // FINAL SUCCESS RESPONSE
    // ========================================

    return NextResponse.json({

      success: true,

      version: VERSION,

      step: fallbackUsed
        ? "ORDER_CREATED_WITH_FALLBACK"
        : "ORDER_CREATED",

      orderIds: returnedOrderIds,

      selectedAddon: result.addon,

      fallbackUsed,

      paymentMode: "manual",

      requestedCurrency: currency,

      skuAttrUsed: skuAttr,

      skuAttrIncluded:
        Object.prototype.hasOwnProperty.call(
          customerProduct,
          "sku_attr"
        ),

      productItems: result.productItems,

      ...verified,
    });

  } catch (error) {

    const message =
      error instanceof Error

        ? error.message

        : "Unknown AliExpress API error";

    console.error(
      "ALIEXPRESS SERVER ERROR:",
      message
    );

    return NextResponse.json(
      {
        success: false,

        version: VERSION,

        confirmedRejected: !submitted,

        uncertain: submitted,

        orderIds: returnedOrderIds,

        step: submitted

          ? "ORDER_RESPONSE_UNCERTAIN"

          : "PRE_SUBMISSION_ERROR",

        message,
      },

      { status: 500 }
    );
  }
}
