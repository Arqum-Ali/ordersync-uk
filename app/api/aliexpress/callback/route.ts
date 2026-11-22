
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const code =
      searchParams.get("code") ||
      searchParams.get("auth_code");

    const state = searchParams.get("state");

    const appKey = process.env.ALIEXPRESS_APP_KEY;
    const appSecret = process.env.ALIEXPRESS_APP_SECRET;
    const expectedState = process.env.ALIEXPRESS_OAUTH_STATE;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    if (
      !appKey ||
      !appSecret ||
      !expectedState ||
      !supabaseUrl ||
      !supabaseKey
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing environment configuration",
        },
        { status: 500 }
      );
    }

    if (!code) {
      return NextResponse.json(
        {
          success: false,
          message: "Authorization code missing",
        },
        { status: 400 }
      );
    }

    if (!state || state !== expectedState) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid OAuth state",
        },
        { status: 403 }
      );
    }

    // Exchange authorization code for AliExpress tokens
    const apiPath = "/auth/token/create";

    const params: Record<string, string> = {
      app_key: appKey,
      code,
      sign_method: "sha256",
      timestamp: Date.now().toString(),
    };

    const sortedKeys = Object.keys(params).sort();

    const signString =
      apiPath +
      sortedKeys.map((key) => key + params[key]).join("");

    const sign = crypto
      .createHmac("sha256", appSecret)
      .update(signString, "utf8")
      .digest("hex")
      .toUpperCase();

    const body = new URLSearchParams({
      ...params,
      sign,
    });

    const apiResponse = await fetch(
      `https://api-sg.aliexpress.com/rest${apiPath}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        cache: "no-store",
      }
    );

    const data = await apiResponse.json();

    if (!apiResponse.ok || !data.access_token || !data.user_id) {
      console.error("AliExpress token exchange failed:", data);

      return NextResponse.json(
        {
          success: false,
          message: "AliExpress token exchange failed",
        },
        { status: 400 }
      );
    }

    // Calculate token expiry dates
    const now = Date.now();

    const accessExpiresIn = Number(data.expires_in) || 86400;
    const refreshExpiresIn = Number(data.refresh_expires_in);

    const accessTokenExpiresAt = new Date(
      now + accessExpiresIn * 1000
    ).toISOString();

    const refreshTokenExpiresAt =
      Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0
        ? new Date(now + refreshExpiresIn * 1000).toISOString()
        : null;

    // Prepare account record
    const accountRecord = {
      account_label: `AliExpress ${data.user_id}`,
      email_label: null,
      aliexpress_user_id: String(data.user_id),
      access_token: data.access_token,
      refresh_token: data.refresh_token || "",
      access_token_expires_at: accessTokenExpiresAt,
      refresh_token_expires_at: refreshTokenExpiresAt,
      connection_status: "connected",
      updated_at: new Date().toISOString(),
    };

    // Save or update the account in Supabase
    const supabaseResponse = await fetch(
      `${supabaseUrl}/rest/v1/aliexpress_accounts?on_conflict=aliexpress_user_id`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(accountRecord),
        cache: "no-store",
      }
    );

    if (!supabaseResponse.ok) {
      const errorText = await supabaseResponse.text();

      console.error("Supabase save failed:", errorText);

      return NextResponse.json(
        {
          success: false,
          message: "AliExpress authorized, but saving tokens to Supabase failed.",
          databaseStatus: supabaseResponse.status,
        },
        { status: 500 }
      );
    }

    // Successful response - never expose actual tokens
    return NextResponse.json({
      success: true,
      message: "AliExpress account connected and saved to Supabase!",
      accountPlatform: data.account_platform,
      userId: String(data.user_id),
      accessTokenReceived: true,
      refreshTokenReceived: Boolean(data.refresh_token),
      accessTokenExpiresAt,
      refreshTokenExpiryAvailable: Boolean(refreshTokenExpiresAt),
      savedToDatabase: true,
    });

  } catch (error) {
    console.error("OAuth callback error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500 }
    );
  }
}
