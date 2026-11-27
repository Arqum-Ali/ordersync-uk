
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

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

function getApiResult(apiData: any) {
  return (
    apiData.aliexpress_ds_order_create_response?.result ??
    apiData.result ??
    apiData
  );
}

function getErrorMessage(apiData: any, apiResult: any): string {
  return (
    apiResult?.error_msg ||
    apiResult?.msg ||
    apiData?.error_response?.msg ||
    apiData?.error_response?.sub_msg ||
    "AliExpress order creation failed."
  );
}

// Only retry when AliExpress explicitly reports a stock-related error.
function isStockError(apiData: any, apiResult: any): boolean {
  const errorText = [
    getErrorMessage(apiData, apiResult),
    apiResult?.error_code,
    apiResult?.code,
    apiData?.error_response?.code,
    apiData?.error_response?.sub_code,
    JSON.stringify(apiResult || {}),
  ]
    .join(" ")
    .toLowerCase();

  const stockKeywords = [
    "out of stock",
    "sold out",
    "insufficient stock",
    "stock insufficient",
    "not enough stock",
    "stock not enough",
    "sku stock",
    "sku unavailable",
    "inventory insufficient",
    "inventory not enough",
    "product unavailable",
    "sku is unavailable",
    "quantity exceeds stock",
    "stock quantity",
  ];

  return stockKeywords.some((keyword) =>
    errorText.includes(keyword)
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const accountId = String(body.accountId || "").trim();
    const productId = String(body.productId || "").trim();
    const quantity = Number(body.quantity);
    const address = body.address || {};

    const paymentMode =
      body.payment === "automatic" ? "automatic" : "manual";

    const currency = String(body.currency || "GBP").toUpperCase();

    const firstName = String(
      address.first_name || address.firstName || ""
    ).trim();

    const lastName = String(
      address.last_name || address.lastName || ""
    ).trim();

    const fullName =
      [firstName, lastName].filter(Boolean).join(" ") ||
      String(address.full_name || "").trim();

    // Input validation
    if (
      !/^\d+$/.test(accountId) ||
      !/^\d+$/.test(productId) ||
      !Number.isSafeInteger(Number(productId)) ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1
    ) {
      return NextResponse.json(
        {
          success: false,
          step: "INPUT_VALIDATION",
          message: "Invalid account ID, product ID or quantity.",
        },
        { status: 400 }
      );
    }

    // Address validation
    const requiredAddressFields = {
      recipientName: fullName,
      address: String(address.address || "").trim(),
      city: String(address.city || "").trim(),
      province: String(address.province || "").trim(),
      country: String(address.country || "").trim().toUpperCase(),
      zip: String(address.zip || "").trim(),
    };

    const missingFields = Object.entries(requiredAddressFields)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (
      missingFields.length > 0 ||
      fullName.length < 2 ||
      fullName.length > 32 ||
      !/^[A-Z]{2}$/.test(requiredAddressFields.country)
    ) {
      return NextResponse.json(
        {
          success: false,
          step: "ADDRESS_VALIDATION",
          message: "Invalid or incomplete delivery address.",
          missingFields,
          recipientNameLength: fullName.length,
        },
        { status: 400 }
      );
    }

    // Currency validation
    if (!["GBP", "USD"].includes(currency)) {
      return NextResponse.json(
        {
          success: false,
          step: "PAYMENT_VALIDATION",
          message: "Unsupported payment currency.",
        },
        { status: 400 }
      );
    }

    // Environment variables
    const appKey = process.env.ALIEXPRESS_APP_KEY;
    const appSecret = process.env.ALIEXPRESS_APP_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    if (!appKey || !appSecret || !supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        {
          success: false,
          step: "ENVIRONMENT_CONFIGURATION",
          message:
            "AliExpress or Supabase environment variables are missing.",
        },
        { status: 500 }
      );
    }

    // Retrieve selected AliExpress account
    const accountResponse = await fetch(
      `${supabaseUrl}/rest/v1/aliexpress_accounts?select=access_token,access_token_expires_at,connection_status&aliexpress_user_id=eq.${encodeURIComponent(accountId)}&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        cache: "no-store",
      }
    );

    if (!accountResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          step: "SUPABASE_ACCOUNT_LOOKUP",
          message: "Could not retrieve AliExpress account.",
          details: await accountResponse.text(),
        },
        { status: 502 }
      );
    }

    const accounts = await accountResponse.json();
    const account = accounts[0];

    if (!account || account.connection_status !== "connected") {
      return NextResponse.json(
        {
          success: false,
          step: "ACCOUNT_VALIDATION",
          message: "Selected AliExpress account is not connected.",
        },
        { status: 404 }
      );
    }

    if (!account.access_token) {
      return NextResponse.json(
        {
          success: false,
          step: "TOKEN_VALIDATION",
          message: "AliExpress access token is missing.",
        },
        { status: 400 }
      );
    }

    if (
      account.access_token_expires_at &&
      Date.now() >= new Date(account.access_token_expires_at).getTime()
    ) {
      return NextResponse.json(
        {
          success: false,
          step: "TOKEN_VALIDATION",
          message: "AliExpress access token has expired.",
        },
        { status: 401 }
      );
    }

    // Phone details
    const mobileNo = String(address.mobile_no || "").replace(/\D/g, "");

    const phoneCountry = String(
      address.phone_country || "+"
    ).trim();

    // Delivery address used for both attempts
    const logisticsAddress = {
      zip: requiredAddressFields.zip,
      country: requiredAddressFields.country,
      address: requiredAddressFields.address,
      address2: String(address.address2 ?? "").trim(),
      city: requiredAddressFields.city,
      contact_person: fullName,
      mobile_no: mobileNo,
      phone_country: phoneCountry,
      full_name: fullName,
      province: requiredAddressFields.province,
    };

    // Original customer product
    const customerProduct = {
      logistics_service_name: String(
        body.logisticsServiceName ?? ""
      ),
      sku_attr: String(body.skuAttr ?? "").trim(),
      product_count: quantity,
      product_id: Number(productId),
      order_memo: String(body.orderMemo ?? ""),
    };

    // Payment settings
    const dsExtendRequest = {
      payment: {
        pay_currency: currency,
        try_to_pay:
          paymentMode === "automatic" ? "true" : "false",
      },
      promotion: {
        promotion_code: "",
      },
    };

    // Create one AliExpress order with two product lines
    async function createAliExpressOrder(addon: typeof FALLBACK_PRODUCTS[number]) {
      const orderRequest = {
        product_items: [
          customerProduct,
          {
            logistics_service_name: String(
              body.logisticsServiceName ?? ""
            ),
            sku_attr: addon.skuAttr,
            product_count: 1,
            product_id: Number(addon.productId),
            order_memo: "",
          },
        ],
        logistics_address: logisticsAddress,
      };

      const method = "aliexpress.ds.order.create";

      const commonParams: Record<string, string> = {
        app_key: appKey!,
        v: "2.0",
        timestamp: Date.now().toString(),
        method,
        format: "json",
        session: account.access_token,
        partner_id: "iop-sdk-java-20181207",
        sign_method: "sha256",
        simplify: "true",
      };

      const businessParams: Record<string, string> = {
        ds_extend_request: JSON.stringify(dsExtendRequest),
        param_place_order_request4_open_api_d_t_o:
          JSON.stringify(orderRequest),
      };

      // Generate AliExpress signature
      const allParams = {
        ...commonParams,
        ...businessParams,
      };

      const signString = Object.keys(allParams)
        .sort()
        .map((key) => key + allParams[key])
        .join("");

      const sign = crypto
        .createHmac("sha256", appSecret!)
        .update(signString, "utf8")
        .digest("hex")
        .toUpperCase();

      const queryParams = new URLSearchParams({
        ...commonParams,
        sign,
      });

      const formBody = new URLSearchParams(businessParams);

      // Do not automatically retry network failures.
      const apiResponse = await fetch(
        `https://api-sg.aliexpress.com/sync?${queryParams.toString()}`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: formBody.toString(),
          cache: "no-store",
        }
      );

      const responseText = await apiResponse.text();

      let apiData: any;

      try {
        apiData = JSON.parse(responseText);
      } catch {
        return {
          success: false,
          uncertain: true,
          message: "AliExpress returned a non-JSON response.",
          httpStatus: apiResponse.status,
          response: responseText.slice(0, 3000),
          addon,
          orderRequest,
        };
      }

      const apiResult = getApiResult(apiData);

      const success =
        apiResponse.ok &&
        !apiData.error_response &&
        apiResult.is_success === true;

      if (success) {
        return {
          success: true,
          addon,
          orderRequest,
          orderIds:
            apiResult.order_list?.number ||
            apiResult.order_list ||
            [],
          apiData,
        };
      }

      return {
        success: false,
        uncertain: false,
        addon,
        orderRequest,
        message: getErrorMessage(apiData, apiResult),
        stockError: isStockError(apiData, apiResult),
        httpStatus: apiResponse.status,
        apiData,
      };
    }

    // FIRST ATTEMPT: Product A
    let firstAttempt;

    try {
      firstAttempt = await createAliExpressOrder(
        FALLBACK_PRODUCTS[0]
      );
    } catch (error) {
      console.error("Product A request failed:", error);

      return NextResponse.json(
        {
          success: false,
          step: "PRODUCT_A_REQUEST_FAILED",
          message:
            "The request to AliExpress failed without a confirmed response. No automatic fallback was attempted to avoid duplicate orders.",
        },
        { status: 502 }
      );
    }

    // Product A succeeded
    if (firstAttempt.success) {
      return NextResponse.json({
        success: true,
        step: "ORDER_CREATED",
        selectedAddon: firstAttempt.addon,
        orderIds: firstAttempt.orderIds,
        paymentMode,
        requestedCurrency: currency,
        productItems: firstAttempt.orderRequest.product_items,
        data: firstAttempt.apiData,
      });
    }

    // Uncertain response: never submit another order
    if (firstAttempt.uncertain) {
      return NextResponse.json(
        {
          success: false,
          step: "PRODUCT_A_RESPONSE_UNCERTAIN",
          message:
            "AliExpress response could not be confirmed. Check your AliExpress orders before trying again.",
          firstAttempt,
        },
        { status: 502 }
      );
    }

    // Only fall back when the first attempt clearly reports a stock error
    if (!firstAttempt.stockError) {
      return NextResponse.json(
        {
          success: false,
          step: "PRODUCT_A_ORDER_FAILED",
          message: firstAttempt.message,
          fallbackAttempted: false,
          firstAttempt,
        },
        { status: 502 }
      );
    }

    // SECOND ATTEMPT: Product B
    let secondAttempt;

    try {
      secondAttempt = await createAliExpressOrder(
        FALLBACK_PRODUCTS[1]
      );
    } catch (error) {
      console.error("Product B request failed:", error);

      return NextResponse.json(
        {
          success: false,
          step: "PRODUCT_B_REQUEST_FAILED",
          message:
            "Product A was rejected for a stock-related error, but the Product B request did not receive a confirmed response. Check AliExpress orders before retrying.",
          firstAttempt,
        },
        { status: 502 }
      );
    }

    if (secondAttempt.success) {
      return NextResponse.json({
        success: true,
        step: "ORDER_CREATED_WITH_FALLBACK",
        selectedAddon: secondAttempt.addon,
        fallbackUsed: true,
        orderIds: secondAttempt.orderIds,
        paymentMode,
        requestedCurrency: currency,
        productItems: secondAttempt.orderRequest.product_items,
        firstAttempt: {
          product: FALLBACK_PRODUCTS[0].name,
          message: firstAttempt.message,
        },
        data: secondAttempt.apiData,
      });
    }

    return NextResponse.json(
      {
        success: false,
        step: "ALL_PRODUCT_ATTEMPTS_FAILED",
        message:
          "Product A and Product B could not be ordered. No successful order was confirmed.",
        firstAttempt: {
          product: FALLBACK_PRODUCTS[0],
          message: firstAttempt.message,
          stockError: firstAttempt.stockError,
        },
        secondAttempt: {
          product: FALLBACK_PRODUCTS[1],
          message: secondAttempt.message,
          httpStatus: secondAttempt.httpStatus,
          response: secondAttempt.apiData,
        },
      },
      { status: 502 }
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    console.error(
      "AliExpress create order error:",
      errorMessage
    );

    return NextResponse.json(
      {
        success: false,
        step: "SERVER_EXCEPTION",
        message: "AliExpress order creation request failed.",
        debug: errorMessage,
      },
      { status: 500 }
    );
  }
}
