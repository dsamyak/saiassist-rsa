export interface PremiumBreakup {
  basePremium: number;
  gstRate: number;
  gstAmount: number;
  totalPremium: number;
}

/**
 * Premium calculation in integer paise to avoid floating point drift.
 * When the configured price includes GST the base is back-calculated, e.g. ₹1000 @18% → 847.46 + 152.54.
 */
export function calculatePremium(price: number, priceIncludesGst: boolean, gstRate: number): PremiumBreakup {
  const rateBp = Math.round(gstRate * 100); // 18% → 1800 basis points
  const pricePaise = Math.round(price * 100);
  let base: number;
  let gst: number;
  if (priceIncludesGst) {
    const total = pricePaise;
    base = Math.round((total * 10000) / (10000 + rateBp));
    gst = total - base;
  } else {
    base = pricePaise;
    gst = Math.round((base * rateBp) / 10000);
  }
  return { basePremium: base / 100, gstRate, gstAmount: gst / 100, totalPremium: (base + gst) / 100 };
}

export const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
