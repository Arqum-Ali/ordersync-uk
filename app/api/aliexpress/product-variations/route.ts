
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

function normalizeList(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === "object") {
    const nested = Object.values(value);
    return nested.length ? nested.flatMap((item) =>
      Array.isArray(item) ? item : [item]
    ) : [];
  }

  return [];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const accountId = String(body.accountId || "").trim();
    const productId = String(body.productId || "").trim();

    if (
      !/^\d+$/.test(accountId) ||
      !/^\d+$/.test(productId) ||
      !Number.isSafeInteger(Number(productId))
    ) {
      return NextResponse.json({
        success: false,
        step: "INPUT_VALIDATION",
        message: "Valid account ID and product ID are required.",
      }, { status: 400 });
    }

    const appKey = process.env.ALIEXPRESS_APP_KEY;
    const appSecret = process.env.ALIEXPRESS_APP_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    if (!appKey || !appSecret || !supabaseUrl || !supabaseKey) {
      return NextResponse.json({
        success: false,
        step: "ENVIRONMENT_CONFIGURATION",
        message: "Required environment variables are missing.",
      }, { status: 500 });
    }

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
      return NextResponse.json({
        success: false,
        step: "SUPABASE_ACCOUNT_LOOKUP",
        message: "Could not retrieve AliExpress account.",
        details: await accountResponse.text(),
      }, { status: 502 });
    }

    const accounts = await accountResponse.json();
    const account = accounts[0];

    if (!account || account.connection_status !== "connected") {
      return NextResponse.json({
        success: false,
        step: "ACCOUNT_VALIDATION",
        message: "Selected AliExpress account is not connected.",
      }, { status: 404 });
    }

    if (!account.access_token) {
      return NextResponse.json({
        success: false,
        step: "TOKEN_VALIDATION",
        message: "AliExpress access token is missing.",
      }, { status: 400 });
    }

    if (
      account.access_token_expires_at &&
      Date.now() >= new Date(account.access_token_expires_at).getTime()
    ) {
      return NextResponse.json({
        success: false,
        step: "TOKEN_VALIDATION",
        message: "AliExpress access token has expired.",
      }, { status: 401 });
    }

    const method = "aliexpress.ds.product.get";

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
      product_id: productId,
      ship_to_country: "GB",
      target_currency: "GBP",
      target_language: "EN",
    };

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

    let apiData: any;

    try {
      apiData = JSON.parse(responseText);
    } catch {
      return NextResponse.json({
        success: false,
        step: "ALIEXPRESS_RESPONSE_PARSING",
        message: "AliExpress returned a non-JSON response.",
        httpStatus: apiResponse.status,
        response: responseText.slice(0, 3000),
      }, { status: 502 });
    }

    const apiResult =
      apiData.aliexpress_ds_product_get_response?.result ??
      apiData.result ??
      apiData;

    if (!apiResponse.ok || apiData.error_response || apiResult.rsp_code) {
      return NextResponse.json({
        success: false,
        step: "ALIEXPRESS_PRODUCT_LOOKUP",
        message: "AliExpress product lookup failed.",
        httpStatus: apiResponse.status,
        error: apiData.error_response || apiResult,
        rawResponse: apiData,
      }, { status: 502 });
    }

    const skuContainer = apiResult.ae_item_sku_info_dtos;
    const skuItems = normalizeList(
      skuContainer?.ae_item_sku_info_d_t_o ?? skuContainer
    );

    const variations = skuItems
      .filter((sku: any) => sku && sku.id)
      .map((sku: any) => {
        const propertyContainer = sku.ae_sku_property_dtos;
        const properties = normalizeList(
          propertyContainer?.ae_sku_property_d_t_o ?? propertyContainer
        );

        const labels = properties.map((property: any) => ({
          name: property.sku_property_name || "",
          value:
            property.sku_property_value ||
            property.property_value_definition_name ||
            "",
        }));

        return {
          skuAttr: String(sku.id),
          label: labels
            .filter((p: any) => p.name || p.value)
            .map((p: any) => `${p.name}: ${p.value}`)
            .join(" / ") || String(sku.id),
          inStock: sku.sku_stock === true ||
            Number(sku.ipm_sku_stock ?? sku.sku_available_stock ?? 0) > 0,
          price: sku.sku_price ?? sku.offer_sale_price ?? null,
          properties: labels,
        };
      });

    return NextResponse.json({
      success: true,
      step: "COMPLETED",
      productId,
      product: apiResult.ae_item_base_info_dto || null,
      variationCount: variations.length,
      variations,
      rawResponse: apiData,
    });

  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    console.error("AliExpress product variations error:", message);

    return NextResponse.json({
      success: false,
      step: "SERVER_EXCEPTION",
      message: "AliExpress product variation lookup failed.",
      debug: message,
    }, { status: 500 });
  }
}

