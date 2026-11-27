
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const url = process.env.ORDER_AUTOMATION_URL;
    const key = process.env.ORDER_AUTOMATION_KEY;

    if (!url || !key) {
      throw new Error(
        "Google Sheets environment variables missing"
      );
    }

    const body = await req.json();

    const allowedActions = [
      "listTabs",
      "getOrders",
      "checkOrder",
      "reserveOrder",
      "saveOrder",
      "recordFailure",
    ];

    if (!allowedActions.includes(body.action)) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid API action",
        },
        { status: 400 }
      );
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        key,
      }),
      cache: "no-store",
      redirect: "follow",
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        "Google Apps Script returned an invalid response"
      );
    }

    return NextResponse.json(data, {
      status:
        response.ok && data.success ? 200 : 400,
    });

  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Google Sheets connection failed",
      },
      { status: 500 }
    );
  }
}
