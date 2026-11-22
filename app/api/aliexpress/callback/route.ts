
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

    if (!appKey || !appSecret || !expectedState) {
      return NextResponse.json(
        { success: false, message: "Missing environment configuration" },
        { status: 500 }
      );
    }

    if (!code) {
      return NextResponse.json(
        { success: false, message: "Authorization code missing" },
        { status: 400 }
      );
    }

    if (!state || state !== expectedState) {
      return NextResponse.json(
        { success: false, message: "Invalid OAuth state" },
        { status: 403 }
      );
    }

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

    if (!apiResponse.ok || !data.access_token) {
      console.error("AliExpress token exchange failed:", data);

      return NextResponse.json(
        {
          success: false,
          message: "AliExpress token exchange failed",
          status: apiResponse.status,
          error: data,
        },
        { status: 400 }
      );
    }

    const response = NextResponse.json({
      success: true,
      message: "AliExpress token received!",
      accountPlatform: data.account_platform,
      userId: data.user_id,
      accessTokenReceived: true,
      refreshTokenReceived: Boolean(data.refresh_token),
      expiresIn: data.expires_in,
    });

    // Temporary secure server-side cookie storage.
    response.cookies.set(
      "ae_access_token",
      data.access_token,
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: Number(data.expires_in) || 86400,
      }
    );

    if (data.refresh_token) {
      response.cookies.set(
        "ae_refresh_token",
        data.refresh_token,
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: Number(data.refresh_expires_in) || 86400,
        }
      );
    }

    return response;

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
