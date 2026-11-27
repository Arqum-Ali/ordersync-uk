
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

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

  const text = String(value ?? "");

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

function getError(data: any, result: any) {

  return String(
    result?.error_msg ||
    result?.msg ||
    data?.error_response?.sub_msg ||
    data?.error_response?.msg ||
    "AliExpress request failed"
  );
}

// ==========================================
// SIGNED ALIEXPRESS API REQUEST
// ==========================================

async function callAliExpress(
  method: string,
  businessParams: Record<string, string>,
  accessToken: string
) {

  const appKey = process.env.ALIEXPRESS_APP_KEY;
  const appSecret = process.env.ALIEXPRESS_APP_SECRET;

  if (!appKey || !appSecret) {
    throw new Error(
      "AliExpress configuration missing"
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

  // Preserve large numeric identifiers as strings.
  const safeJson = raw.replace(
    /("(?:order_id|product_id|id|child_id)"\s*:\s*)(\d{16,})(?=\s*[,}])/g,
    '$1"$2"'
  ).replace(
    /("(?:order_list|number)"\s*:\s*\[)([\d,\s]+)(\])/g,
    (_, start, values, end) =>
      start +
      values.replace(/\d+/g, (v: string) => `"${v}"`) +
      end
  );

  let data: any;

  try {
    data = JSON.parse(safeJson);
  } catch {
    throw new Error(
      "AliExpress returned an invalid JSON response"
    );
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

// ==========================================
// RETRIEVE ALIEXPRESS ACCOUNT
// ==========================================

async function getAccount(accountId: string) {

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error("Supabase configuration missing");
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
    throw new Error("Could not retrieve account");
  }

  const accounts = await response.json();
  const account = accounts[0];

  if (
    !account ||
    account.connection_status !== "connected"
  ) {
    throw new Error("Account is not connected");
  }

  if (!account.access_token) {
    throw new Error("Access token missing");
  }

  if (
    account.access_token_expires_at &&
    Date.now() >= new Date(
      account.access_token_expires_at
    ).getTime()
  ) {
    throw new Error("Access token expired");
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

  if (
    !response.ok ||
    response.data.error_response
  ) {
    throw new Error("Order detail query failed");
  }

  const result =
    response.data
      .aliexpress_trade_ds_order_get_response
      ?.result ??
    response.data.result;

  if (!result || typeof result !== "object") {
    throw new Error("Order details unavailable");
  }

  return result;
}

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
// VERIFY ORIGINAL ORDER AND PRICE
// ==========================================

async function verifyOriginalOrder(
  orderIds: string[],
  productId: string,
  quantity: number,
  currency: string,
  accessToken: string
) {

  // Only read-only queries are retried.
  // Order creation is never retried here.

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

        if (!matching.length) continue;

        // Do not treat a combined original + addon
        // order total as the original product price.

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
      }
    }

    if (
      allResolved &&
      matches.length === 1
    ) {
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
      "Order created, but original Order ID or GBP amount could not be verified.",
  };
}

// ==========================================
// MAIN ORDER CREATION API
// ==========================================

export async function POST(req: NextRequest) {

  let submitted = false;

  try {

    const body = await req.json();

    const accountId = validId(body.accountId);
    const productId = validId(body.productId);
    const quantity = Number(body.quantity);

    const address = body.address || {};

    // SKU ATTR IS OPTIONAL
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
          message: "Invalid account, product or quantity",
        },
        { status: 400 }
      );
    }

    if (
      fullName.length < 2 ||
      fullName.length > 32 ||
      !address.address ||
      !address.city ||
      !address.province ||
      !address.zip ||
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

    const logisticsAddress = {
      zip: String(address.zip).replace(/\s+/g, ""),
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

    const customerProduct = {
      product_id: Number(productId),
      product_count: quantity,

      // Empty SKU Attr is accepted here.
      sku_attr: skuAttr,

      logistics_service_name: String(
        body.logisticsServiceName || ""
      ),
      order_memo: String(body.orderMemo || ""),
    };

    const dsExtendRequest = {
      payment: {
        pay_currency: currency,
        try_to_pay: "false",
      },
      promotion: {
        promotion_code: "",
      },
    };

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

      const result =
        response.data
          .aliexpress_ds_order_create_response
          ?.result ??
        response.data.result ??
        response.data;

      const orderIds = extractIds(result);

      const success =
        response.ok &&
        !response.data.error_response &&
        result.is_success === true;

      const message = getError(
        response.data,
        result
      );

      const stockError =
        /out of stock|sold out|insufficient stock|inventory insufficient|stock not enough/i
          .test(message);

      return {
        success,
        orderIds,
        message,
        stockError,
        addon,
        productItems,
        apiData: response.data,

        // An explicit rejection alone does not
        // prove the multi-product request was atomic.
        explicitRejection:
          response.ok &&
          result.is_success === false &&
          orderIds.length === 0,
      };
    }

    // ========================================
    // PRODUCT A
    // ========================================

    let result = await createOrder(
      FALLBACK_PRODUCTS[0]
    );

    let fallbackUsed = false;

    // Enable automatic fallback only if you have
    // verified that stock rejection is atomic.

    const allowFallback =
      process.env.ALIEXPRESS_ATOMIC_STOCK_FALLBACK
      === "true";

    if (
      !result.success &&
      result.explicitRejection &&
      result.stockError &&
      allowFallback
    ) {

      result = await createOrder(
        FALLBACK_PRODUCTS[1]
      );

      fallbackUsed = true;
    }

    if (!result.success) {

      return NextResponse.json(
        {
          success: false,
          confirmedRejected: false,
          uncertain: true,
          step: "ORDER_FAILED",
          message: result.message,
          orderIds: result.orderIds,
          fallbackUsed,
        },
        { status: 502 }
      );
    }

    // ========================================
    // VERIFY ORDER ID AND ACTUAL ORDER AMOUNT
    // ========================================

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

    return NextResponse.json({
      success: true,
      step: fallbackUsed
        ? "ORDER_CREATED_WITH_FALLBACK"
        : "ORDER_CREATED",

      orderIds: result.orderIds,

      selectedAddon: result.addon,
      fallbackUsed,
      paymentMode: "manual",
      requestedCurrency: currency,
      skuAttrUsed: skuAttr,
      productItems: result.productItems,

      ...verified,
    });

  } catch (error) {

    return NextResponse.json(
      {
        success: false,
        confirmedRejected: !submitted,
        uncertain: submitted,

        step: submitted
          ? "ORDER_RESPONSE_UNCERTAIN"
          : "INPUT_VALIDATION",

        message:
          error instanceof Error
            ? error.message
            : "Order request failed",
      },
      { status: 500 }
    );
  }
}
