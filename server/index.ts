import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import pgSession from "connect-pg-simple";
import { runMigrations } from 'stripe-replit-sync';
import { registerRoutes } from "./routes";
import { initCron } from "./lib/cron";
import { setupVite, serveStatic, log } from "./vite";
import { pool } from "./db";
import { getStripeSync } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import stripeRoutes from "./routes/stripe";

if (!process.env.ADMIN_SECRET || process.env.ADMIN_SECRET.trim().length === 0) {
  console.error(
    "FATAL: ADMIN_SECRET is not set. Admin endpoints (e.g. /api/admin/*, " +
    "/api/stripe/seed-products) refuse to start without it. Set ADMIN_SECRET " +
    "to a strong random value in this environment's Secrets."
  );
  process.exit(1);
}

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.trim().length === 0) {
  console.error(
    "FATAL: SESSION_SECRET is not set. The session middleware refuses to start " +
    "without it so user sessions are never signed with a known-weak key. Set " +
    "SESSION_SECRET to a strong random value in this environment's Secrets."
  );
  process.exit(1);
}

const app = express();

// Trust the Replit / hosting proxy so req.ip and req.protocol reflect the
// real client instead of a spoofed X-Forwarded-For header.
app.set("trust proxy", 1);

const PgStore = pgSession(session);

app.use(session({
  store: new PgStore({
    pool: pool,
    tableName: 'sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax"
  }
}));

const stripeWebhookHandler = async (req: any, res: any) => {
    const signature = req.headers['stripe-signature'];

    if (!signature) {
      console.error('STRIPE WEBHOOK: Missing stripe-signature header');
      return res.status(400).json({ error: 'Missing stripe-signature' });
    }

    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;

      if (!Buffer.isBuffer(req.body)) {
        console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer');
        return res.status(500).json({ error: 'Webhook processing error' });
      }

      await WebhookHandlers.processWebhook(req.body as Buffer, sig);

      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error('Stripe webhook error:', error.message);
      res.status(400).json({ error: 'Webhook processing error' });
    }
};

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  limit: '50mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

app.use('/api/stripe', stripeRoutes);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log('Skipping Stripe init: DATABASE_URL not set');
    return;
  }

  try {
    console.log('Initializing Stripe schema...');
    await runMigrations({ databaseUrl });
    console.log('Stripe schema ready');

    const stripeSync = await getStripeSync();

    console.log('Setting up managed webhook...');
    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    const webhookResult = await stripeSync.findOrCreateManagedWebhook(
      `${webhookBaseUrl}/api/stripe/webhook`
    );
    if (webhookResult?.webhook?.url) {
      console.log(`Webhook configured: ${webhookResult.webhook.url}`);
    } else {
      console.log('Webhook setup completed (no URL returned - this is normal for existing webhooks)');
    }

    console.log('Syncing Stripe data in background...');
    stripeSync.syncBackfill()
      .then(() => console.log('Stripe data synced'))
      .catch((err: any) => console.error('Error syncing Stripe data:', err));
  } catch (error) {
    console.error('Failed to initialize Stripe:', error);
  }
}

(async () => {
  try {
    await initStripe();
    initCron();

    const server = await registerRoutes(app);

    // Health check endpoint for production deployment
    app.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Error handler - log but don't crash
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      console.error('Error:', err);
      res.status(status).json({ message });
      // Don't throw - just log the error
    });

    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Other ports are firewalled. Default to 5000 if not specified.
    // this serves both the API and the client.
    // It is the only port that is not firewalled.
    const port = parseInt(process.env.PORT || '5000', 10);
    // reusePort is a Linux/Replit affordance; it throws ENOTSUP on macOS.
    server.listen({
      port,
      host: "0.0.0.0",
      ...(process.platform === "linux" ? { reusePort: true } : {}),
    }, () => {
      log(`serving on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})().catch((error) => {
  console.error('Unhandled error during startup:', error);
  process.exit(1);
});
