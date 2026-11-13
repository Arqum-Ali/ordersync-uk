
import { NextRequest, NextResponse } from 'next/server';
import { parseEbayWorkbook } from '@/lib/transform';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';
export const maxDuration = 60;

const allowedAccounts = ['Betelbee', 'Tayyab', 'Sell High'];

const allowedMonths = [
  'January', 'February', 'March', 'April',
  'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'
];

function normalize(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeOrderNumber(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number') return value;

  let text = String(value ?? '').trim();

  if (!text || text === '--') return 0;

  const isNegative = text.startsWith('(') && text.endsWith(')');

  text = text
    .replace(/[£$€,]/g, '')
    .replace(/[()]/g, '')
    .trim();

  const amount = Number(text);

  if (!Number.isFinite(amount)) return 0;

  return isNegative ? -amount : amount;
}

function getTransactionEarnings(buffer: Buffer): Map<string, number> {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    raw: true
  });

  const earnings = new Map<string, number>();
  let headerFound = false;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    const data = XLSX.utils.sheet_to_json<any[]>(sheet, {
      header: 1,
      defval: '',
      raw: true
    });

    let headerRowIndex = -1;
    let typeIndex = -1;
    let orderNumberIndex = -1;
    let netAmountIndex = -1;

    for (let i = 0; i < data.length; i++) {
      const headers = data[i].map(normalize);

      const type = headers.indexOf('type');
      const orderNumber = headers.indexOf('ordernumber');
      const netAmount = headers.indexOf('netamount');

      if (type !== -1 && orderNumber !== -1 && netAmount !== -1) {
        headerRowIndex = i;
        typeIndex = type;
        orderNumberIndex = orderNumber;
        netAmountIndex = netAmount;
        headerFound = true;
        break;
      }
    }

    if (headerRowIndex === -1) continue;

    for (let i = headerRowIndex + 1; i < data.length; i++) {
      const row = data[i];

      const type = normalize(row[typeIndex]);
      const orderNumber = normalizeOrderNumber(row[orderNumberIndex]);

      if (!orderNumber) continue;

      if (type !== 'order' && type !== 'otherfee') continue;

      const amount = parseAmount(row[netAmountIndex]);
      const current = earnings.get(orderNumber) || 0;

      earnings.set(orderNumber, current + amount);
    }
  }

  if (!headerFound) {
    throw new Error(
      'Transaction Report is missing the Type, Order number, or Net amount columns.'
    );
  }

  return earnings;
}

export async function POST(req: NextRequest) {
  try {
    const url = process.env.GOOGLE_SCRIPT_URL;
    const secret = process.env.IMPORT_SECRET;

    if (!url || !secret) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Set GOOGLE_SCRIPT_URL and IMPORT_SECRET in environment variables.'
        },
        { status: 500 }
      );
    }

    const form = await req.formData();

    const file = form.get('file');
    const transactionFile = form.get('transactionFile');

    const account = String(form.get('account') || '').trim();
    const month = String(form.get('month') || '').trim();

    if (!allowedAccounts.includes(account)) {
      return NextResponse.json(
        { ok: false, error: 'Please select a valid eBay account.' },
        { status: 400 }
      );
    }

    if (!allowedMonths.includes(month)) {
      return NextResponse.json(
        { ok: false, error: 'Please select a valid order month.' },
        { status: 400 }
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: 'Please choose the eBay Orders file.' },
        { status: 400 }
      );
    }

    if (!(transactionFile instanceof File)) {
      return NextResponse.json(
        { ok: false, error: 'Please choose the Transaction Report file.' },
        { status: 400 }
      );
    }

    const allowedExtensions = ['.xlsx', '.xls', '.csv'];

    const orderFileName = file.name.toLowerCase();
    const transactionFileName = transactionFile.name.toLowerCase();

    if (!allowedExtensions.some(ext => orderFileName.endsWith(ext))) {
      return NextResponse.json(
        { ok: false, error: 'Orders file must be .xlsx, .xls, or .csv.' },
        { status: 400 }
      );
    }

    if (!allowedExtensions.some(ext => transactionFileName.endsWith(ext))) {
      return NextResponse.json(
        { ok: false, error: 'Transaction Report must be .xlsx, .xls, or .csv.' },
        { status: 400 }
      );
    }

    // Read eBay Orders file.
    const rows = parseEbayWorkbook(
      Buffer.from(await file.arrayBuffer())
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No valid eBay orders found in the Orders file.' },
        { status: 400 }
      );
    }

    // Read Transaction Report.
    const transactionBuffer = Buffer.from(
      await transactionFile.arrayBuffer()
    );

    const earningsByOrder = getTransactionEarnings(transactionBuffer);

    let earningsMatched = 0;
    let earningsNotFound = 0;

    const unmatchedOrderNumbers: string[] = [];

    // Match earnings using the order number.
    const taggedRows = rows.map((item: any) => {
      const values = Array.isArray(item.values)
        ? [...item.values]
        : [];

      // Preserve the original order number for display.
      const originalOrderNumber = String(values[0] ?? '').trim();

      // Use normalized number only for matching.
      const orderNumber = normalizeOrderNumber(originalOrderNumber);

      if (orderNumber && earningsByOrder.has(orderNumber)) {
        values[8] = Number(
          (earningsByOrder.get(orderNumber) || 0).toFixed(2)
        );

        earningsMatched++;
      } else {
        values[8] = '';
        earningsNotFound++;

        if (originalOrderNumber) {
          unmatchedOrderNumbers.push(originalOrderNumber);
        }
      }

      return {
        ...item,
        values,
        account,
        month
      };
    });

    // Send prepared orders to Google Apps Script.
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        secret,
        rows: taggedRows
      }),
      redirect: 'follow',
      cache: 'no-store'
    });

    const result = await response.json().catch(() => null);

    if (!response.ok || !result?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result?.error ||
            `Google Sheets update failed (${response.status}).`
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ...result,
      earningsMatched,
      earningsNotFound,
      unmatchedOrderNumbers: [...new Set(unmatchedOrderNumbers)],
      message: 'Orders imported with earnings calculated from the Transaction Report.'
    });

  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error
          ? e.message
          : 'Unexpected error.'
      },
      { status: 500 }
    );
  }
}
