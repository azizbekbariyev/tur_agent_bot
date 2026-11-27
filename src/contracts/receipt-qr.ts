/**
 * Kvitansiyadagi QR (8-bosqich): shu versiya tokeni bilan ochiq tekshirish sahifasi manzili.
 * Domen kodga yozilmaydi: PUBLIC_BASE_URL (bo'lmasa - mavjud FRONTEND_URL, filial sayti).
 * Ikkalasi ham bo'lmasa - QR chizilmaydi (PDF'da bo'sh joy qoladi).
 */
import QRCode from 'qrcode';

export function publicBaseUrl(): string | null {
  const raw = process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || '';
  const base = raw.trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(base) ? base : null;
}

export function publicReceiptUrl(token: string): string | null {
  const base = publicBaseUrl();
  return base ? `${base}/k/${token}` : null;
}

/** QR rasmi (PNG). M darajadagi xato tuzatish; chop etilganda ~2 sm dan katta chiziladi */
export async function receiptQrPng(token: string): Promise<Buffer | null> {
  const url = publicReceiptUrl(token);
  if (!url) return null;
  return QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 360,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}
