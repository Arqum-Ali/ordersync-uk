
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // 1. Read frontend data
    const body = await req.json();

    const accountId = String(body.accountId || "").trim();
    const productId = String(body.productId || "").trim();
    const quantity = Number(body.quantity);

    const address = body.address || {};

    const paymentMode =
      body.payment === "automatic" ? "automatic" : "manual";

    const currency = String(body.currency || "GBP").toUpperCase();

    // 2. Build recipient name
    const firstName = String(
      address.first_name || address.firstName || ""
    ).trim();

    const lastName = String(
      address.last_name || address.lastName || ""
    ).trim();

    const existingFullName = String(address.full_name || "").trim();

    const fullName = [firstName, lastName]
      .filter(Boolean)
      .join(" ") || existingFullName;

    // 3. Validate order information
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

    // 4. Validate delivery address
    const requiredAddressFields = {
      recipientName: fullName,
      address: String(address.address || "").trim(),
      city: String(address.city || "").trim(),
      province: String(address.province || "").trim(),
      country: String(address.country || "").trim().toUpperCase(),
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

    // 5. Environment variables
    const appKey = process.env.ALIEXPRESS_APP_KEY;
    const appSecret = process.env.ALIEXPRESS_APP_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    if (!appKey || !appSecret || !supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        {
          success: false,
          step: "ENVIRONMENT_CONFIGURATION",
          message: "AliExpress or Supabase environment variables are missing.",
        },
        { status: 500 }
      );
    }

    // 6. Retrieve selected AliExpress account
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

    // 7. Prepare order information
    const orderId = `ORD-${Date.now()}`;

    const cleanPhone = String(address.mobile_no || "")
      .replace(/[\s()+-]/g, "");

    const cleanPhoneCountry = String(address.phone_country || "")
      .replace(/[\s()+-]/g, "");

    const orderRequest: Record<string, any> = {
      out_order_id: orderId,

      logistics_address: {
        contact_person: fullName,
        full_name: fullName,

        address: requiredAddressFields.address,
        city: requiredAddressFields.city,
        province: requiredAddressFields.province,
        country: requiredAddressFields.country,

        ...(address.address2
          ? { address2: String(address.address2).trim() }
          : {}),

        ...(address.zip
          ? { zip: String(address.zip).trim() }
          : {}),

        ...(cleanPhone
          ? { mobile_no: cleanPhone }
          : {}),

        ...(cleanPhoneCountry
          ? { phone_country: cleanPhoneCountry }
          : {}),
      },

      product_items: [
        {
          product_id: Number(productId),
          product_count: quantity,

          ...(body.skuAttr
            ? { sku_attr: String(body.skuAttr).trim() }
            : {}),
        },
      ],
    };

    // 8. Prepare AliExpress API parameters
    const method = "aliexpress.ds.order.create";

    const commonParams: Record<string, string> = {
      app_key: appKey,
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
      param_place_order_request4_open_api_d_t_o:
        JSON.stringify(orderRequest),

      payment: JSON.stringify({
        pay_currency: currency,
        try_to_pay: paymentMode === "automatic" ? "true" : "false",
      }),
    };

    // 9. Generate signature
    const allParams = {
      ...commonParams,
      ...businessParams,
    };

    const signString = Object.keys(allParams)
      .sort()
      .map((key) => key + allParams[key])
      .join("");

    const sign = crypto
      .createHmac("sha256", appSecret)
      .update(signString, "utf8")
      .digest("hex")
      .toUpperCase();

    const queryParams = new URLSearchParams({
      ...commonParams,
      sign,
    });

    const formBody = new URLSearchParams(businessParams);

    // 10. Submit order to AliExpress
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

    // 11. Read response
    const responseText = await apiResponse.text();

    let apiData: any;

    try {
      apiData = JSON.parse(responseText);
    } catch {
      return NextResponse.json(
        {
          success: false,
          step: "ALIEXPRESS_RESPONSE_PARSING",
          message: "AliExpress returned a non-JSON response.",
          httpStatus: apiResponse.status,
          response: responseText.slice(0, 3000),
        },
        { status: 502 }
      );
    }

    const apiResult =
      apiData.aliexpress_ds_order_create_response?.result ??
      apiData.result ??
      apiData;

    if (
      !apiResponse.ok ||
      apiData.error_response ||
      apiResult.is_success !== true
    ) {
      return NextResponse.json(
        {
          success: false,
          step: "ALIEXPRESS_ORDER_CREATION",
          message:
            apiResult.error_msg ||
            apiData.error_response?.msg ||
            "AliExpress order creation failed.",

          httpStatus: apiResponse.status,
          error: apiData.error_response || apiResult,
          rawResponse: apiData,

          debug: {
            recipientNameSent: fullName,
            contactPersonSent: fullName,
            countrySent: requiredAddressFields.country,
            citySent: requiredAddressFields.city,
            provinceSent: requiredAddressFields.province,
          },
        },
        { status: 502 }
      );
    }

    // 12. Return successful response
    return NextResponse.json({
      success: true,
      step: "ORDER_CREATED",
      outOrderId: orderId,
      orderIds: apiResult.order_list || [],
      paymentMode,
      data: apiData,
    });

  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : String(error);

    console.error("AliExpress create order error:", errorMessage);

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
