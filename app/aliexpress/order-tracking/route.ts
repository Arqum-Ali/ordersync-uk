
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const accountId = String(body.accountId || "").trim();
    const orderId = String(body.orderId || "").trim();
    const language = String(body.language || "en_US").trim();

    if (!accountId || !/^\d+$/.test(orderId)) {
      return NextResponse.json(
        {
          success: false,
          step: "INPUT_VALIDATION",
          message: "Valid account and order ID are required.",
        },
        { status: 400 }
      );
    }

    const appKey = process.env.ALIEXPRESS_APP_KEY;
    const appSecret = process.env.ALIEXPRESS_APP_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    if (!appKey || !appSecret || !supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        {
          success: false,
          step: "ENVIRONMENT_CONFIGURATION",
          message: "Required server environment variables are missing.",
        },
        { status: 500 }
      );
    }

    // Retrieve the connected AliExpress account.
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
          message: "Supabase account lookup failed.",
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
          message: "Access token is missing.",
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
          message: "Access token has expired. Reauthorize this account.",
        },
        { status: 401 }
      );
    }

    // Tracking API method.
    const method = "aliexpress.ds.order.tracking.get";

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
      ae_order_id: orderId,
      language,
    };

    // Generate the AliExpress API signature.
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

    // Call AliExpress.
    const apiResponse = await fetch(
      `https://api-sg.aliexpress.com/sync?${queryParams.toString()}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: formBody.toString(),
        cache: "no-store",
      }
    );

    const responseText = await apiResponse.text();

    let result: any;

    try {
      result = JSON.parse(responseText);
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

    if (!apiResponse.ok || result.error_response) {
      return NextResponse.json(
        {
          success: false,
          step: "ALIEXPRESS_API",
          message: "AliExpress could not retrieve tracking information.",
          httpStatus: apiResponse.status,
          error: result.error_response || result,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      step: "COMPLETED",
      orderId,
      data: result,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);

    console.error("AliExpress tracking API error:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        step: "SERVER_EXCEPTION",
        message: "AliExpress tracking API failed.",
        debug: {
          error: errorMessage,
        },
      },
      { status: 500 }
    );
  }
}
