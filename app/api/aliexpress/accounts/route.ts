
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        {
          success: false,
          message: "Supabase configuration missing",
        },
        { status: 500 }
      );
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/aliexpress_accounts?select=account_label,aliexpress_user_id,connection_status,access_token_expires_at,updated_at&order=updated_at.desc`,
      {
        method: "GET",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("AliExpress accounts query failed:", error);

      return NextResponse.json(
        {
          success: false,
          message: "Could not retrieve AliExpress accounts",
        },
        { status: 500 }
      );
    }

    const accounts = await response.json();

    return NextResponse.json({
      success: true,
      count: accounts.length,
      accounts,
    });

  } catch (error) {
    console.error("AliExpress accounts API error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500 }
    );
  }
}
