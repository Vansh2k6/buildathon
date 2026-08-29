/**
 * lib/execute/razorpay.ts — Thin REST client for Razorpay API in Test Mode (T-60).
 * Source of truth: ADR-009 / smoke-razorpay.ts probe results.
 */

const BASE_URL = 'https://api.razorpay.com/v1';

export class RazorpayApiError extends Error {
  public statusCode: number;
  public rawBody: string;

  constructor(message: string, statusCode: number, rawBody: string) {
    super(message);
    this.name = 'RazorpayApiError';
    this.statusCode = statusCode;
    this.rawBody = rawBody;
  }
}

export interface RazorpayPaymentLinkParams {
  amount_p: number; // amount in integer paise
  description: string;
  reference_id?: string;
}

export interface RazorpayPaymentLinkResult {
  id: string; // e.g. plink_TU8E0gJQ84hVfl
  short_url: string; // e.g. https://rzp.io/i/xxxx
  status: string;
}

export interface RazorpayOrderParams {
  amount_p: number; // amount in integer paise
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResult {
  id: string; // e.g. order_TU8E0EINggeQU2
  amount: number;
  status: string;
}

function getAuthHeader(): string {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) {
    throw new Error('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing in environment');
  }
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

/**
 * Creates a Razorpay Payment Link (POST /v1/payment_links).
 * Primary representation tier (ADR-009).
 */
export async function createRazorpayPaymentLink(
  params: RazorpayPaymentLinkParams,
): Promise<RazorpayPaymentLinkResult> {
  const auth = getAuthHeader();

  const body = {
    amount: params.amount_p,
    currency: 'INR',
    description: params.description,
    reference_id: params.reference_id,
  };

  let attempt = 0;
  let res: Response | null = null;
  let text = '';

  while (attempt < 4) {
    attempt++;
    res = await fetch(`${BASE_URL}/payment_links`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    text = await res.text();
    if (res.ok) break;
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    break;
  }

  if (!res || !res.ok) {
    throw new RazorpayApiError(`Razorpay payment_links API returned HTTP ${res?.status ?? 0}`, res?.status ?? 0, text);
  }

  const json = JSON.parse(text);
  return {
    id: json.id,
    short_url: json.short_url,
    status: json.status ?? 'created',
  };
}

/**
 * Creates a Razorpay Order (POST /v1/orders).
 */
export async function createRazorpayOrder(
  params: RazorpayOrderParams,
): Promise<RazorpayOrderResult> {
  const auth = getAuthHeader();

  const body = {
    amount: params.amount_p,
    currency: 'INR',
    receipt: params.receipt,
    notes: params.notes,
  };

  let attempt = 0;
  let res: Response | null = null;
  let text = '';

  while (attempt < 2) {
    attempt++;
    res = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    text = await res.text();
    if (res.ok) break;
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    break;
  }

  if (!res || !res.ok) {
    throw new RazorpayApiError(`Razorpay orders API returned HTTP ${res?.status ?? 0}`, res?.status ?? 0, text);
  }

  const json = JSON.parse(text);
  return {
    id: json.id,
    amount: json.amount,
    status: json.status ?? 'created',
  };
}
