
import * as XLSX from 'xlsx';

export type ImportRow = {
  month: string;
  values: (string | number)[];
  importKey: string;
};

const aliases: Record<string, string[]> = {
  order: ['Order number', 'Order Number', 'Order ID'],
  name: ['Post to name', 'Ship to name', 'Buyer name', 'Recipient name'],
  address1: ['Post to address 1', 'Ship to address 1', 'Address 1'],
  address2: ['Post to address 2', 'Ship to address 2', 'Address 2'],
  city: ['Post to city', 'Ship to city', 'City'],
  county: ['Post to county', 'Ship to county', 'County', 'State'],
  postcode: ['Post to postcode', 'Ship to postcode', 'Postcode', 'Postal code', 'ZIP'],
  country: ['Post to country', 'Ship to country', 'Country'],
  phone: ['Post to phone', 'Ship to phone', 'Phone number', 'Buyer phone'],
  product: ['Item title', 'Item title/name', 'Product title', 'Title'],
  quantity: ['Quantity', 'Qty'],
  saleDate: ['Sale date', 'Order date', 'Date sold'],
  dispatchDate: ['Post by date', 'Ship by date', 'Dispatch by date'],
  tracking: ['Tracking number', 'Tracking'],
  itemId: ['Transaction ID', 'Transaction number', 'Item ID', 'Item number'],
  variation: ['Variation details', 'Variations', 'Custom label'],
};

function norm(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

// Validate the standard eBay Order Number format.
// Example: 17-15383-79882
function isValidOrderNumber(order: string): boolean {
  return /^\d{2}-\d{5}-\d{5}$/.test(order);
}

// Read Excel dates and eBay dates such as 6-Nov-26
function excelDate(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  }

  if (typeof v === 'number') {
    const p = XLSX.SSF.parse_date_code(v);

    if (p) {
      return new Date(p.y, p.m - 1, p.d);
    }
  }

  const s = asText(v);

  if (!s) return null;

  // eBay date format: 6-Nov-26 or 06-Nov-2026
  const match = s.match(
    /^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2}|\d{4})$/
  );

  if (match) {
    const day = Number(match[1]);
    const monthText = match[2].toLowerCase();

    let year = Number(match[3]);

    if (year < 100) {
      year += year >= 70 ? 1900 : 2000;
    }

    const months = [
      'jan', 'feb', 'mar', 'apr',
      'may', 'jun', 'jul', 'aug',
      'sep', 'oct', 'nov', 'dec',
    ];

    const month = months.indexOf(monthText);

    if (month === -1) return null;

    const date = new Date(year, month, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date;
  }

  // Fallback for other recognised date formats
  const d = new Date(s);

  if (isNaN(d.getTime())) return null;

  return d;
}

function dateText(v: unknown): string {
  if (!asText(v)) return '';

  const d = excelDate(v);

  if (!d) return asText(v);

  const day = String(d.getDate()).padStart(2, '0');

  const month = d.toLocaleString('en-GB', {
    month: 'short',
  });

  const year = d.getFullYear();

  return `${day}-${month}-${year}`;
}

function monthName(d: Date): string {
  return d.toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
  });
}

export function parseEbayWorkbook(buffer: Buffer): ImportRow[] {
  const book = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    raw: false,
  });

  const sheet = book.Sheets[book.SheetNames[0]];

  if (!sheet) {
    throw new Error('The uploaded Excel file has no worksheet.');
  }

  const matrix: unknown[][] = XLSX.utils.sheet_to_json(
    sheet,
    {
      header: 1,
      defval: '',
      raw: false,
    }
  );

  let headerRow = -1;
  let headerMap = new Map<string, number>();

  // Find the header row in the first 15 rows
  for (let r = 0; r < Math.min(matrix.length, 15); r++) {
    const candidate = new Map<string, number>();

    (matrix[r] || []).forEach((v, i) => {
      if (asText(v)) {
        candidate.set(norm(v), i);
      }
    });

    if (
      candidate.has('order number') ||
      candidate.has('order id')
    ) {
      headerRow = r;
      headerMap = candidate;
      break;
    }
  }

  if (headerRow < 0) {
    throw new Error(
      'Could not find the "Order number" column in the first 15 rows.'
    );
  }

  const findCol = (key: string): number => {
    for (const alias of aliases[key]) {
      const idx = headerMap.get(norm(alias));

      if (idx !== undefined) return idx;
    }

    return -1;
  };

  const get = (row: unknown[], key: string): unknown => {
    const i = findCol(key);

    return i < 0 ? '' : row[i] ?? '';
  };

  if (findCol('order') < 0) {
    throw new Error('Order number column is missing.');
  }

  if (findCol('saleDate') < 0) {
    throw new Error('Sale date column is missing.');
  }

  const output: ImportRow[] = [];

  // Remember the last valid month for rows with an empty Sale Date.
  let previousMonth = '';

  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];

    const order = asText(get(row, 'order'));

    // Ignore empty rows, footer text and invalid order numbers.
    if (!isValidOrderNumber(order)) continue;

    const saleValue = get(row, 'saleDate');
    const saleValueText = asText(saleValue);

    let sale: Date | null = null;
    let currentMonth = '';

    if (saleValueText) {
      sale = excelDate(saleValue);

      if (!sale) {
        throw new Error(
          `Could not read the sale date for order ${order}. Value received: "${saleValueText}".`
        );
      }

      currentMonth = monthName(sale);
      previousMonth = currentMonth;
    } else {
      // Keep the Sale Date cell empty.
      // Use the previous valid row's month only for tab placement.
      if (!previousMonth) {
        throw new Error(
          `Order ${order} has an empty Sale Date and there is no previous row to determine its monthly tab.`
        );
      }

      currentMonth = previousMonth;
    }

    const name = asText(get(row, 'name'));
    const address1 = asText(get(row, 'address1'));
    const address2 = asText(get(row, 'address2'));
    const city = asText(get(row, 'city'));
    const county = asText(get(row, 'county'));
    const postcode = asText(get(row, 'postcode'));
    const country = asText(get(row, 'country'));
    const phone = asText(get(row, 'phone'));

    const locality = [city, county]
      .filter(Boolean)
      .join(', ');

    const townLine = [locality, postcode]
      .filter(Boolean)
      .join(' ');

    const address = [
      name,
      address1,
      address2,
      townLine,
      country,
      phone,
    ]
      .filter(Boolean)
      .join('\n');

    const product = asText(get(row, 'product'));

    const qtyRaw = get(row, 'quantity');

    const qty =
      qtyRaw === ''
        ? ''
        : Number(qtyRaw) || asText(qtyRaw);

    // Leave Sale Date blank if the source cell is blank.
    const saleText = sale ? dateText(sale) : '';

    // Leave Dispatch Date blank if the source cell is blank.
    const dispatchText = dateText(get(row, 'dispatchDate'));

    const tracking = asText(get(row, 'tracking'));
    const itemId = asText(get(row, 'itemId'));
    const variation = asText(get(row, 'variation'));

    // Buyer name and address are NOT used for duplicate checking.
    const lineIdentity =
      itemId ||
      `${norm(product)}||${norm(variation)}||${qty}`;

    const importKey = `${order}::${lineIdentity}`;

    // A:M target layout.
    const values: (string | number)[] = [
      order,
      saleText,
      address,
      dispatchText,
      qty,
      product,
      '',
      '',
      '',
      '',
      '',
      tracking,
      '',
    ];

    output.push({
      month: currentMonth,
      values,
      importKey,
    });
  }

  if (!output.length) {
    throw new Error(
      'No valid eBay order rows were found. Check the Order Number format.'
    );
  }

  return output;
}
