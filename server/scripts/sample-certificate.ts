// Renders a sample certificate with fictional data: `npx tsx server/scripts/sample-certificate.ts [out.pdf] [logo.png|jpg]`
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { renderCertificatePdf } from '../pdf/certificate';
import { sampleSnapshot } from '../pdf/sample';
import { platformSettingsSchema } from '../services/settings';

const out = process.argv[2] ?? 'dist/sample-certificate.pdf';
const logoPath = process.argv[3];
const settings = platformSettingsSchema.parse({});
const snap = sampleSnapshot(settings);
const logo = logoPath
  ? { bytes: new Uint8Array(readFileSync(logoPath)), mimeType: logoPath.endsWith('.png') ? 'image/png' : 'image/jpeg' }
  : null;
const bytes = await renderCertificatePdf(snap, { logo, generatedAt: new Date('2026-10-14T11:24:44Z') });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log(`Wrote ${out} (${bytes.length} bytes)`);
