import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import QRCode from 'qrcode';
import { formatDateString, formatIstDateTime } from '../lib/dates';
import { money } from '../lib/money';
import { fuelTypeLabel, vehicleTypeLabel } from '../../shared/constants';

/** Everything printed on a certificate. Stored immutably on the policy at issuance. */
export interface CertificateSnapshot {
  version: 1;
  platformName: string;
  policyNumber: string | null;
  issuedAt: string | null;
  startDate: string;
  endDate: string;
  dealer: {
    id: string;
    code: string;
    name: string;
    legalName: string | null;
    logoFileId: string | null;
    issuerName: string;
    servicingOffice: string;
    gstin: string | null;
    rsaPhone: string;
    rsaEmail: string;
    rsaWebsite: string;
  };
  customer: {
    name: string;
    dob: string | null;
    mobile: string;
    email: string | null;
    address: string;
    city: string;
    state: string;
    pincode: string;
  };
  vehicle: {
    registrationNo: string | null;
    vehicleType: string;
    make: string;
    model: string;
    variant: string;
    engineNo: string | null;
    chassisNo: string | null;
    fuelType: string;
    manufacturingYear: number;
  };
  plan: {
    productId: string;
    productCode: string;
    planName: string;
    certificatePlanName: string;
    termLabel: string;
    numberOfServices: number;
    benefits: { name: string; description: string; applicable: string }[];
  };
  premium: { basePremium: number; gstRate: number; gstAmount: number; totalPremium: number };
  conditions: string;
  template: {
    title: string;
    showQr: boolean;
    showCompanyName: boolean;
    showDob: boolean;
    showGstin: boolean;
    borderColor: string;
    conditionsHeading: string;
    footerNote: string;
  };
  verifyUrl: string | null;
}

export interface RenderOptions {
  logo?: { bytes: Uint8Array; mimeType: string } | null;
  watermark?: { text: string; color?: [number, number, number] } | null;
  generatedAt?: Date;
  /** Printed instead of the certificate number when none has been allocated yet. */
  placeholderNumber?: string;
}

// ---- Geometry measured from the reference certificate (A4, points, origin top-left) ----
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const X0 = 36.1;
const X1 = 546.0;
const XMID = 326.7;
const PAD_X = 1.8;
const BODY = 7;
const LINE = 7.85;
const FIRST_BASELINE = 8.35;
const BOTTOM_PAD = 3.6;
const OUTER_W = 0.75;
const INNER_W = 1.5;
const BOTTOM_LIMIT = 796;
const CONT_TOP = 40;
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const MUTED = rgb(0.38, 0.38, 0.38);

interface Fonts {
  reg: PDFFont;
  bold: PDFFont;
  times: PDFFont;
  timesBold: PDFFont;
}
interface Run {
  text: string;
  font: PDFFont;
  size: number;
}
interface Line {
  runs: Run[];
  /** Distance from the previous line's baseline (ignored for the first line of a cell). */
  advance: number;
}
interface Cell {
  x0: number;
  x1: number;
  lines: Line[];
  align?: 'left' | 'center';
}
interface Row {
  cells: Cell[];
  minHeight: number;
  firstBaseline?: number;
}

const REPLACEMENTS: Record<string, string> = {
  '₹': 'Rs.',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  ' ': ' ',
  '\t': ' ',
};

/** Standard PDF fonts use WinAnsi encoding; anything outside it is replaced so rendering never fails. */
function makeSanitizer(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  return (s: string | null | undefined): string =>
    Array.from((s ?? '').normalize('NFC'))
      .map((ch) => {
        if (ch === '\n') return ch;
        if (REPLACEMENTS[ch] !== undefined) return REPLACEMENTS[ch];
        return supported.has(ch.codePointAt(0)!) ? ch : '?';
      })
      .join('');
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  const width = (s: string) => font.widthOfTextAtSize(s, size);
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (let word of words) {
      while (width(word) > maxWidth) {
        const room = line ? maxWidth - width(`${line} `) : maxWidth;
        let i = 0;
        while (i < word.length && width(word.slice(0, i + 1)) <= room) i++;
        if (i === 0) {
          out.push(line);
          line = '';
          continue;
        }
        out.push(line ? `${line} ${word.slice(0, i)}` : word.slice(0, i));
        line = '';
        word = word.slice(i);
      }
      if (!word) continue;
      const candidate = line ? `${line} ${word}` : word;
      if (width(candidate) <= maxWidth) line = candidate;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return rgb(0.82, 0.82, 0.82);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

class Layout {
  page!: PDFPage;
  pages: PDFPage[] = [];
  y = 0;

  constructor(
    private doc: PDFDocument,
    private border: RGB,
  ) {
    this.addPage();
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = CONT_TOP;
  }

  text(s: string, x: number, baseline: number, font: PDFFont, size: number, color: RGB = BLACK) {
    if (s) this.page.drawText(s, { x, y: PAGE_H - baseline, font, size, color });
  }

  hline(x0: number, x1: number, y: number, w: number) {
    this.page.drawLine({ start: { x: x0, y: PAGE_H - y }, end: { x: x1, y: PAGE_H - y }, thickness: w, color: this.border });
  }

  vline(x: number, y0: number, y1: number, w: number) {
    this.page.drawLine({ start: { x, y: PAGE_H - y0 }, end: { x, y: PAGE_H - y1 }, thickness: w, color: this.border });
  }

  rowHeight(row: Row) {
    const fb = row.firstBaseline ?? FIRST_BASELINE;
    let h = row.minHeight;
    for (const cell of row.cells) {
      if (!cell.lines.length) continue;
      const rest = cell.lines.slice(1).reduce((sum, l) => sum + l.advance, 0);
      h = Math.max(h, fb + rest + BOTTOM_PAD);
    }
    return h;
  }

  private drawRow(row: Row, isFirstInSegment: boolean) {
    const h = this.rowHeight(row);
    const top = this.y;
    this.hline(X0, X1, top, isFirstInSegment ? OUTER_W : INNER_W);
    for (const cell of row.cells.slice(1)) this.vline(cell.x0, top, top + h, INNER_W);
    for (const cell of row.cells) {
      let baseline = top + (row.firstBaseline ?? FIRST_BASELINE);
      cell.lines.forEach((line, i) => {
        if (i > 0) baseline += line.advance;
        const w = line.runs.reduce((s, r) => s + r.font.widthOfTextAtSize(r.text, r.size), 0);
        let x = cell.align === 'center' ? (cell.x0 + cell.x1) / 2 - w / 2 : cell.x0 + PAD_X;
        for (const r of line.runs) {
          this.text(r.text, x, baseline, r.font, r.size);
          x += r.font.widthOfTextAtSize(r.text, r.size);
        }
      });
    }
    this.y += h;
  }

  private closeSegment(top: number) {
    this.hline(X0, X1, this.y, OUTER_W);
    this.vline(X0, top, this.y, OUTER_W);
    this.vline(X1, top, this.y, OUTER_W);
  }

  /** Draws a bordered table; if it overflows the page it continues on a new page, repeating header rows. */
  table(rows: Row[], headerRows = 0) {
    let segTop = this.y;
    let first = true;
    rows.forEach((row, i) => {
      if (!first && this.y + this.rowHeight(row) > BOTTOM_LIMIT) {
        this.closeSegment(segTop);
        this.addPage();
        segTop = this.y;
        first = true;
        if (i >= headerRows) {
          for (const hr of rows.slice(0, headerRows)) {
            this.drawRow(hr, first);
            first = false;
          }
        }
      }
      this.drawRow(row, first);
      first = false;
    });
    this.closeSegment(segTop);
  }

  ensureSpace(h: number) {
    if (this.y + h > BOTTOM_LIMIT) this.addPage();
  }
}

function drawQr(page: PDFPage, value: string, x: number, top: number, size: number) {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const quiet = 1;
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y: PAGE_H - top - size, width: size, height: size, color: WHITE });
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!data[r * n + c]) {
        c++;
        continue;
      }
      let end = c;
      while (end + 1 < n && data[r * n + end + 1]) end++;
      page.drawRectangle({
        x: x + (quiet + c) * cell,
        y: PAGE_H - (top + (quiet + r + 1) * cell) - 0.02,
        width: (end - c + 1) * cell,
        height: cell + 0.04,
        color: BLACK,
      });
      c = end + 1;
    }
  }
}

function drawWatermark(page: PDFPage, text: string, font: PDFFont, color: RGB) {
  let size = 78;
  while (font.widthOfTextAtSize(text, size) > 640 && size > 20) size -= 2;
  const w = font.widthOfTextAtSize(text, size);
  const a = (35 * Math.PI) / 180;
  const cx = PAGE_W / 2;
  const cy = PAGE_H / 2;
  const x = cx - (w / 2) * Math.cos(a) + size * 0.35 * Math.sin(a);
  const y = cy - (w / 2) * Math.sin(a) - size * 0.35 * Math.cos(a);
  page.drawText(text, { x, y, size, font, color, rotate: degrees(35), opacity: 0.16 });
}

const gstLabel = (rate: number) => `GST @${Number.isInteger(rate) ? rate : Number(rate.toFixed(2))}%`;

export async function renderCertificatePdf(s: CertificateSnapshot, opts: RenderOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f: Fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    times: await doc.embedFont(StandardFonts.TimesRoman),
    timesBold: await doc.embedFont(StandardFonts.TimesRomanBold),
  };
  const clean = makeSanitizer(f.reg);
  const t = s.template;
  const L = new Layout(doc, hexToRgb(t.borderColor));
  const page = L.page;

  const bodyLines = (text: string, width: number, font = f.bold, size = BODY): Line[] =>
    wrap(clean(text), font, size, width).map((tx) => ({ runs: [{ text: tx, font, size }], advance: LINE }));
  const LW = XMID - X0 - PAD_X * 2;
  const RW = X1 - XMID - PAD_X * 2;
  const left = (lines: Line[], align: Cell['align'] = 'left'): Cell => ({ x0: X0, x1: XMID, lines, align });
  const right = (lines: Line[]): Cell => ({ x0: XMID, x1: X1, lines });
  const full = (lines: Line[], align: Cell['align'] = 'center'): Cell => ({ x0: X0, x1: X1, lines, align });
  const pair = (l: string, r: string, minHeight: number): Row => ({
    cells: [left(bodyLines(l, LW)), right(bodyLines(r, RW))],
    minHeight,
  });

  // ---- Header: logo, title + certificate number, QR ----
  const companyName = clean(s.dealer.legalName || s.dealer.name);
  if (opts.logo && (isPng(opts.logo.bytes) || isJpeg(opts.logo.bytes))) {
    const img = isPng(opts.logo.bytes) ? await doc.embedPng(opts.logo.bytes) : await doc.embedJpg(opts.logo.bytes);
    const scale = Math.min(106.2 / img.width, 40 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: 34.5, y: PAGE_H - (54.7 + h / 2), width: w, height: h });
    if (t.showCompanyName) {
      wrap(companyName, f.bold, BODY, 150)
        .slice(0, 2)
        .forEach((ln, i) => L.text(ln, 36.1, 83 + i * LINE, f.bold, BODY));
    }
  } else {
    wrap(companyName, f.bold, 11, 150)
      .slice(0, 3)
      .forEach((ln, i) => L.text(ln, 36.1, 52 + i * 13, f.bold, 11));
  }

  const titleText = clean(`${t.title} :`);
  const certNo = s.policyNumber ?? opts.placeholderNumber ?? 'PREVIEW';
  const numberText = clean(certNo);
  const TITLE_CX = 304.75;
  L.text(titleText, TITLE_CX - f.timesBold.widthOfTextAtSize(titleText, 13) / 2, 60.2, f.timesBold, 13);
  L.text(numberText, TITLE_CX - f.timesBold.widthOfTextAtSize(numberText, 13) / 2, 74.6, f.timesBold, 13);

  if (t.showQr && s.verifyUrl) {
    drawQr(page, s.verifyUrl, 497, 26, 50);
    const cap = 'Scan to verify';
    L.text(cap, 522 - f.reg.widthOfTextAtSize(cap, 5.5) / 2, 82, f.reg, 5.5, MUTED);
  }

  // ---- Certificate issuer, holder and period ----
  L.y = 94.8;
  const issuerLines: Line[] = [
    ...bodyLines(`Certificate issuer & Servicing Office : ${s.dealer.issuerName}`, LW),
    { runs: [], advance: LINE },
    ...bodyLines(s.dealer.servicingOffice, LW),
  ];
  if (t.showGstin && s.dealer.gstin) issuerLines.push(...bodyLines(`GSTIN : ${s.dealer.gstin}`, LW));
  const phone = clean(s.dealer.rsaPhone);
  const rsaLines: Line[] = [
    ...bodyLines('For Road Side Assistance,', RW),
    {
      runs: [
        { text: 'Please contact on toll free no : ', font: f.bold, size: BODY },
        { text: phone, font: f.times, size: 12 },
      ],
      advance: 12.3,
    },
    ...bodyLines(`Email : ${s.dealer.rsaEmail}`, RW).map((l, i) => ({ ...l, advance: i === 0 ? 8.9 : LINE })),
    ...bodyLines(`Web : ${s.dealer.rsaWebsite}`, RW),
  ];
  const c = s.customer;
  const address = [c.address, c.city, [c.state, c.pincode].filter(Boolean).join(' - ')].filter(Boolean).join(', ');
  L.table([
    { cells: [left(issuerLines), right(rsaLines)], minHeight: 54.1, firstBaseline: 7.9 },
    pair(`Tax Invoice Cum Certificate Number : ${certNo}`, `Certificate Start Date : ${formatIstDateTime(s.startDate)}`, 17),
    pair(`Name of the Certificate Holder : ${c.name}`, `Certificate End Date : ${formatIstDateTime(s.endDate)}`, 17),
    pair(`Customer DOB : ${t.showDob ? formatDateString(c.dob) : ''}`, `Customer Mobile No : ${c.mobile}`, 18.5),
    pair(`Customer Address : ${address}`, `Customer Email ID : ${c.email ?? ''}`, 26.4),
  ]);

  // ---- Vehicle details ----
  const v = s.vehicle;
  L.y += 5.8;
  L.table([
    { cells: [full(bodyLines('Vehicle Details', X1 - X0, f.bold, 8).map((l) => ({ ...l })))], minHeight: 15.5, firstBaseline: 8.9 },
    pair(`Registration No : ${v.registrationNo || 'New'}`, `Vehicle Type : ${vehicleTypeLabel(v.vehicleType)}`, 16.6),
    pair(`Make and Model : ${[v.make, v.model].filter(Boolean).join(' ')}`, `Variant : ${v.variant}`, 17),
    pair(`Engine No : ${v.engineNo ?? ''}`, `Chassis No : ${v.chassisNo ?? ''}`, 17),
    pair(`Fuel Type : ${fuelTypeLabel(v.fuelType)}`, `Manufacturing Year : ${v.manufacturingYear}`, 16.7),
  ]);

  // ---- Coverage ----
  const C = [X0, 75.7, 249.2, 494.0, X1];
  const covCell = (i: number, lines: Line[], align: Cell['align'] = 'left'): Cell => ({ x0: C[i], x1: C[i + 1], lines, align });
  const colW = (i: number) => C[i + 1] - C[i] - PAD_X * 2;
  const benefitRows: Row[] = s.plan.benefits.map((b, i) => ({
    cells: [
      covCell(0, bodyLines(String(i + 1), colW(0)), 'center'),
      covCell(1, bodyLines(b.name, colW(1))),
      covCell(2, bodyLines(b.description, colW(2))),
      covCell(3, bodyLines(b.applicable, colW(3))),
    ],
    minHeight: 17,
  }));
  L.y += 4.6;
  L.ensureSpace(17 + 19.2 + 17 * 2);
  L.table(
    [
      {
        cells: [
          full([
            {
              runs: [
                { text: 'Coverages of Road Side Assistance - Toll free No.  ', font: f.bold, size: 8 },
                { text: phone, font: f.times, size: 12 },
              ],
              advance: LINE,
            },
          ]),
        ],
        minHeight: 17,
        firstBaseline: 12.4,
      },
      {
        cells: [
          covCell(0, bodyLines('Sl. No.', colW(0)), 'center'),
          covCell(1, bodyLines('Featured Benefits', colW(1))),
          covCell(2, bodyLines('Description', colW(2))),
          covCell(3, bodyLines('Applicable', colW(3))),
        ],
        minHeight: 19.2,
      },
      ...benefitRows,
      {
        cells: [
          covCell(0, bodyLines(String(s.plan.benefits.length + 1), colW(0)), 'center'),
          covCell(1, bodyLines('Number of Services', colW(1))),
          covCell(2, bodyLines('during a plan', colW(2))),
          covCell(3, bodyLines(String(s.plan.numberOfServices), colW(3))),
        ],
        minHeight: 16.6,
      },
    ],
    2,
  );

  // ---- Premium breakup ----
  const P = [X0, 209.2, 311.8, 451.7, X1];
  const pCell = (i: number, txt: string): Cell => ({
    x0: P[i],
    x1: P[i + 1],
    lines: bodyLines(txt, P[i + 1] - P[i] - PAD_X * 2),
    align: 'center',
  });
  L.y += 4.8;
  L.ensureSpace(14 + 18.1 + 16.6);
  L.table([
    { cells: [full(bodyLines('RSA Premium Breakup', X1 - X0))], minHeight: 14, firstBaseline: 7.9 },
    { cells: [pCell(0, 'Plan Name'), pCell(1, 'Amount in Rs'), pCell(2, gstLabel(s.premium.gstRate)), pCell(3, 'Total Premium')], minHeight: 18.1 },
    {
      cells: [
        pCell(0, s.plan.certificatePlanName || s.plan.planName),
        pCell(1, money(s.premium.basePremium)),
        pCell(2, money(s.premium.gstAmount)),
        pCell(3, money(s.premium.totalPremium)),
      ],
      minHeight: 16.6,
    },
  ]);

  // ---- Special conditions ----
  const condText = clean([t.conditionsHeading, s.conditions].filter(Boolean).join(' '));
  let baseline = L.y + 16.5;
  for (const ln of wrap(condText, f.reg, BODY, X1 - 37.8)) {
    if (baseline > BOTTOM_LIMIT) {
      L.addPage();
      baseline = CONT_TOP + 8;
    }
    L.text(ln, 37.8, baseline, f.reg, BODY);
    baseline += LINE;
  }

  // ---- Footer on every page ----
  const generatedAt = opts.generatedAt ?? new Date();
  const meta = [
    s.verifyUrl ? `Verify: ${s.verifyUrl}` : null,
    `Issued through ${s.dealer.name}`,
    `Generated: ${formatIstDateTime(generatedAt)} IST`,
  ]
    .filter(Boolean)
    .join('   |   ');
  L.pages.forEach((pg, i) => {
    const note = clean(t.footerNote);
    if (note) pg.drawText(note, { x: X0, y: PAGE_H - 812, size: 6, font: f.reg, color: MUTED });
    pg.drawText(clean(meta), { x: X0, y: PAGE_H - 821, size: 6, font: f.reg, color: MUTED });
    if (L.pages.length > 1) {
      const label = `Page ${i + 1} of ${L.pages.length}`;
      pg.drawText(label, { x: X1 - f.reg.widthOfTextAtSize(label, 6), y: PAGE_H - 821, size: 6, font: f.reg, color: MUTED });
    }
    if (opts.watermark) {
      const [r, g, b] = opts.watermark.color ?? [0.5, 0.5, 0.5];
      drawWatermark(pg, clean(opts.watermark.text), f.bold, rgb(r, g, b));
    }
  });

  doc.setTitle(`RSA Certificate ${s.policyNumber ?? 'Preview'}`);
  doc.setAuthor(clean(s.dealer.name));
  doc.setSubject(clean(`${t.title} ${s.policyNumber ?? ''}`.trim()));
  doc.setCreator(clean(s.platformName));
  doc.setProducer(clean(`${s.platformName} Certificate Engine`));
  const created = s.issuedAt ? new Date(s.issuedAt) : generatedAt;
  doc.setCreationDate(created);
  doc.setModificationDate(generatedAt);
  return doc.save({ useObjectStreams: false });
}

/** Stamps an existing (stored) certificate, e.g. "CANCELLED", without altering the preserved original. */
export async function stampPdf(bytes: Uint8Array, text: string, color: [number, number, number]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const pg of doc.getPages()) drawWatermark(pg, text, font, rgb(...color));
  return doc.save({ useObjectStreams: false });
}
