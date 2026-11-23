import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const accountId = String(body.accountId || "").trim();
    const orderId = String(body.orderId || "").trim();

    if (!accountId || !/^\d+$/.test(orderId)) {
      return NextResponse.json(
        { success: false, message: "Valid account and order ID are required." },
        { status: 400 }
      );
    }

    const appKey = process.env.ALIEXPRESS_APP_KEY;
    const appSecret = process.env.ALIEXPRESS_APP_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    if (!appKey || !appSecret || !supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { success: false, message: "Server configuration is missing." },
        { status: 500 }
      );
    }

    // Retrieve the selected account's token securely from Supabase.
    const accountResponse = await fetch(
      `${supabaseUrl}/rest/v1/aliexpress_accounts?select=access_token,access_token_expires_at,connection_status&aliexpress_user_id=eq.${encodeURIComponent(accountId)}&limit=1`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        cache: "no-store",
      }
    );

    if (!accountResponse.ok) {
      return NextResponse.json(
        { success: false, message: "Could not retrieve the selected account." },
        { status: 500 }
      );
    }

    const accounts = await accountResponse.json();
    const account = accounts[0];

    if (!account || account.connection_status !== "connected") {
      return NextResponse.json(
        { success: false, message: "Selected AliExpress account is not connected." },
        { status: 404 }
      );
    }

    if (!account.access_token) {
      return NextResponse.json(
        { success: false, message: "Access token is missing." },
        { status: 400 }
      );
    }

    if (
      account.access_token_expires_at &&
      Date.now() >= new Date(account.access_token_expires_at).getTime()
    ) {
      return NextResponse.json(
        { success: false, message: "Access token has expired. Reauthorize this account." },
        { status: 401 }
      );
    }

    // AliExpress TOP API parameters.
    const method = "aliexpress.trade.ds.order.get";

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

    // The API expects single_order_query as a JSON object.
    const businessParams: Record<string, string> = {
      single_order_query: JSON.stringify({
        order_id: Number(orderId),
      }),
    };

    // Sign all common and business parameters.
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

    // Send request using the AliExpress IOP TOP protocol.
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
      console.error("AliExpress returned a non-JSON response.");
      return NextResponse.json(
        { success: false, message: "AliExpress returned an invalid response." },
        { status: 502 }
      );
    }

    if (!apiResponse.ok || result.error_response) {
      console.error("AliExpress order API error:", {
        status: apiResponse.status,
        error: result.error_response || "Unknown API error",
      });

      return NextResponse.json(
        {
          success: false,
          message: "AliExpress could not retrieve this order.",
          error: result.error_response || null,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      orderId,
      data: result,
    });

  } catch (error) {
    console.error("AliExpress order details API error:", error);

    return NextResponse.json(
      { success: false, message: "Internal server error." },
      { status: 500 }
    );
  }
}
