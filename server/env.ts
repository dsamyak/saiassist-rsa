// Runtime configuration. Values are read lazily so serverless platforms can inject them at invocation time.

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

export const env = {
  get nodeEnv() {
    return process.env.NODE_ENV ?? 'development';
  },
  get isProd() {
    return process.env.NODE_ENV === 'production';
  },
  get port() {
    return Number(process.env.PORT ?? 8787);
  },
  /** PostgreSQL connection string. When empty the embedded PGlite database is used. */
  get databaseUrl() {
    return process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  },
  get pgliteDir() {
    return process.env.PGLITE_DATA_DIR || '.data/pglite';
  },
  get jwtSecret(): string {
    const s = process.env.JWT_SECRET;
    if (s && s.length >= 32) return s;
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set (min 32 characters) in production');
    }
    return 'dev-only-insecure-jwt-secret-change-me-0123456789';
  },
  /** Public URL used in certificate QR codes, e.g. https://rsa.example.com. Falls back to the request origin. */
  get publicBaseUrl() {
    return (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  },
  get superAdmin() {
    return {
      email: (process.env.SUPERADMIN_EMAIL || 'admin@saiassist.local').toLowerCase(),
      password: process.env.SUPERADMIN_PASSWORD || 'Admin@12345',
      name: process.env.SUPERADMIN_NAME || 'Platform Super Admin',
    };
  },
  get seedDemo() {
    return bool(process.env.SEED_DEMO, true);
  },
  get demoPassword() {
    return process.env.DEMO_PASSWORD || 'Demo@12345';
  },
  get resendApiKey() {
    return process.env.RESEND_API_KEY || '';
  },
  get emailFrom() {
    return process.env.EMAIL_FROM || '';
  },
  get smsWebhookUrl() {
    return process.env.SMS_WEBHOOK_URL || '';
  },
  get whatsappWebhookUrl() {
    return process.env.WHATSAPP_WEBHOOK_URL || '';
  },
  get cookieSecure() {
    return bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production');
  },
};
