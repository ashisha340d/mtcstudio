const http = require('http');
const express = require('express');
const path = require('path');
const cors = require('cors');
const { hostname, networkInterfaces } = require('os');

const APP_ENV = process.env.APP_ENV || 'local';
require('dotenv').config({ path: path.resolve(__dirname, `.env.${APP_ENV}`) });

function envPort(name, fallback) {
  const port = parseInt(process.env[name], 10);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

const HOST = process.env.HOST || '0.0.0.0';
const PORT = envPort('PORT', 3001);

// ── CMS routes ────────────────────────────────────────────────
const categoriesRouter = require('./routes/categories');
const productsRouter = require('./routes/products');
const mediaRouter = require('./routes/media');
const blogsRouter = require('./routes/blogs');
const generateBlogRouter = require('./routes/generateBlog');
const liveshelfRouter = require('./routes/liveshelf');
const cakeCatalogueRouter = require('./routes/cakeCatalogue');
const dashboardRouter = require('./routes/dashboard');
const crmRouter = require('./routes/crm');
const automationRouter = require('./routes/automation');
const settingsRouter = require('./routes/settings');
const ocrRouter = require('./routes/ocr');

// ── POS routes ────────────────────────────────────────────────
const db = require('./pos/db');
const cmsDb = require('./database/db');
const socketServer = require('./pos/socketServer');
const posAuthRouter = require('./routes/pos/auth');
const posMasterRouter = require('./routes/pos/master');
const posOrdersRouter = require('./routes/pos/orders');
const posKotsRouter = require('./routes/pos/kots');
const posCustomersRouter = require('./routes/pos/customers');
const posTillRouter = require('./routes/pos/till');
const posMaintenanceRouter = require('./routes/pos/maintenance');
const foodMenuRouter = require('./routes/pos/foodmenu');
const cakeOrdersRouter = require('./routes/pos/cakeOrders');
const cakeProductionRouter = require('./routes/pos/cakeProduction');
const posWaiterRouter = require('./routes/pos/waiter');
const posReportsRouter = require('./routes/pos/reports');
const posTransactionsRouter = require('./routes/pos/transactions');
const posWebOrdersRouter = require('./routes/pos/webOrders');
const webOrderBridge = require('./services/webOrderBridge');

const { errorHandler } = require('./middleware/errorHandler');
const { startAutoSync } = require('./services/liveShelfSync');
const systemRouter = require('./routes/system');
const customerRouter = require('./routes/customer');

// ── App ───────────────────────────────────────────────────────
const app = express();
app.locals.db = db;

app.use(cors({ origin: (origin, cb) => cb(null, true), credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static assets ─────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '1y', immutable: true }));
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '1y', immutable: true }));

// ── React build (production) ──────────────────────────────────
const clientBuild = path.join(__dirname, 'public', 'client-build');
app.use(express.static(clientBuild));

// ── API routes ────────────────────────────────────────────────
app.use('/api/customer', customerRouter);
app.use('/api/ocr', ocrRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/media', mediaRouter);
app.use('/api/blogs', blogsRouter);
app.use('/api/generate-blog', generateBlogRouter);
app.use('/api/liveshelf', liveshelfRouter);
app.use('/api/cake-catalogue', cakeCatalogueRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/crm', crmRouter);
app.use('/api/automation', automationRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/system', systemRouter);
app.use('/api/auth', posAuthRouter);
app.use('/api/pos', posMasterRouter);
app.use('/api/pos/orders', posOrdersRouter);
app.use('/api/pos/kots', posKotsRouter);
app.use('/api/pos/customers', posCustomersRouter);
app.use('/api/pos/ledger', posCustomersRouter);
app.use('/api/pos/till', posTillRouter);
app.use('/api/maintenance', posMaintenanceRouter);
app.use('/api/food-menu', foodMenuRouter);
app.use('/api/pos/cake-orders', cakeOrdersRouter);
app.use('/api/pos/cake-production', cakeProductionRouter);
app.use('/api/pos/waiter', posWaiterRouter);
app.use('/api/pos/reports', posReportsRouter);
app.use('/api/pos/transactions', posTransactionsRouter);
app.use('/api/pos/web-orders', posWebOrdersRouter);

// ── Cake Production PWA (own build, own path, own manifest/SW scope) ──
// Registered before the generic SPA fallback below so /cake-app/* is never
// swallowed by the POS SPA's catch-all.
const cakeAppBuild = path.join(__dirname, 'public', 'cake-production-build');
app.use('/cake-app', express.static(cakeAppBuild));
app.get('/cake-app', (req, res) => res.redirect(301, '/cake-app/'));
app.get('/cake-app/{*path}', (req, res) => res.sendFile(path.join(cakeAppBuild, 'index.html')));

// ── SPA fallback (must be after all API routes) ───────────────
app.get('/{*path}', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
  res.sendFile(path.join(clientBuild, 'index.html'));
});

app.use(errorHandler);

// ── Server ────────────────────────────────────────────────────
const mainServer = http.createServer(app);

const io = socketServer.init(mainServer);
app.locals.io = io;

function getNetworkIP() {
  const all = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) all.push(addr.address);
    }
  }
  const lan = all.find(ip =>
    /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
  return lan || all[0] || '0.0.0.0';
}

Promise.all([cmsDb.ready, db.ready]).catch(err => {
  console.error('Database schema initialization failed:', err);
  process.exit(1);
}).then(() => {
  mainServer.listen(PORT, HOST, () => {
    const ip = getNetworkIP();
    const base = `http://${ip}:${PORT}`;
    startAutoSync(60_000);
    webOrderBridge.start(); // WS client → website's /pos-bridge (web order queue)
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║          MTC Studio Server — Ready           ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Env        →  ${APP_ENV}`);
    console.log(`  IP / Port  →  ${ip}:${PORT}`);
    console.log(`  Bind       →  ${HOST}:${PORT}`);
    console.log(`  Hostname   →  ${hostname()}`);
    console.log('');
    console.log(`  POS        →  ${base}/pos`);
    console.log(`  Waiter     →  ${base}/waiter`);
    console.log(`  KDS        →  ${base}/kds`);
    console.log(`  CRM        →  ${base}/crm`);
    console.log(`  Admin      →  ${base}/`);
    console.log('');
    console.log(`  API        →  ${base}/api/`);
    console.log(`  Socket.IO  →  ws://${ip}:${PORT}`);
    console.log('');
  });
});
