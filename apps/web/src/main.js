//env
import dotenv from 'dotenv';
dotenv.config({ quiet: true }); // Load .env variables

//app
import fs from 'fs'
import http from 'http'
import express from 'express';
import cookieParser from "cookie-parser";
import bodyParser from 'body-parser'
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { getClient } from '#infra/mongo';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..', '..');  // -> <repo>

//routes
import index_routes from '#routes/index';

//logging
import log4js from 'log4js';
import '#infra/logger';
const logger = log4js.getLogger('main');

// app
const app = express();

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/', express.static('apps/web/src/public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  const requestId = randomUUID();
  const ip = (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress
  logger.info({
    id: requestId,
    ip: ip,
    method: req.method,
    path: req.url,
    route: req.route?.path,
    status: "start"
  })
  res.on('finish', async () => {            // fires after headers/body sent
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    var clogger = null;
    if (res.statusCode >= 200 && res.statusCode < 300) {
      clogger = logger.info.bind(logger)
    } else if (res.statusCode >= 300 && res.statusCode < 400) {
      if (req.route?.path === "/subscribe") {
        clogger = logger.info.bind(logger)
      } else {
        clogger = logger.trace.bind(logger)
      }
    } else if (res.statusCode >= 400 && res.statusCode < 500) {
      clogger = logger.warn.bind(logger)
    } else if (res.statusCode >= 500) {
      clogger = logger.error.bind(logger)
    }
    clogger({
      id: requestId,
      ip: ip,
      method: req.method,
      statusCode: res.statusCode,
      path: req.url,
      route: req.route?.path,
      status: "complete",
      ms: ms
    })
  });
  next()
});

app.use('/', index_routes);

app.use(function (req, res) {
  res.status(404).render('pages/404');
});

var httpServer = http.createServer(app);

if (process.env.snapenv === "dev") {
  const port = process.env.instance === undefined ? 9081 : 9082; //for testing load balance
  httpServer.listen(port);
} else {
  httpServer.listen(80);
}

// --- data fetch
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

globalThis.earningsCache = null;
let earningsRefreshRunning = false;

async function fetchEarningsData() {
  logger.debug('fetching earnings data')
  const to = new Date();
  const from = new Date(to.getTime() - 30 * DAY_MS);

  const client = await getClient('fetchEarningsData')
  const rows = await client
    .db('crypto')
    .collection('sia')
    .aggregate([
      {
        $match: {
          timestamp: {
            $gt: from,
            $lte: to
          }
        }
      },
      {
        $group: {
          _id: {
            $dateFromParts: {
              year: { $year: '$timestamp' },
              month: { $month: '$timestamp' },
              day: { $dayOfMonth: '$timestamp' },
              hour: { $hour: '$timestamp' }
            }
          },
          // Sum as Decimal128 before converting for chart display.
          amount: {
            $sum: { $toDecimal: '$amount' }
          }
        }
      },
      {
        $sort: { _id: 1 }
      },
      {
        $project: {
          _id: 1,
          amountMilliSC: {
            $toDouble: {
              $multiply: [
                '$amount',
                { $toDecimal: '0.000000000000000000000001' }
              ]
            }
          }
        }
      }
    ], {
      maxTimeMS: 120_000
    })
    .toArray();

  const hourly = [];
  const dailyTotals = new Map();
  let totalMilliSC = 0;

  for (const row of rows) {
    const timestamp = row._id.getTime();
    const amount = row.amountMilliSC;

    if (!Number.isFinite(amount)) {
      throw new Error('Invalid earnings amount');
    }

    hourly.push([timestamp, amount]);
    totalMilliSC += amount;

    // Group into UTC days, matching your original aggregation.
    const dayTimestamp = Math.floor(timestamp / DAY_MS) * DAY_MS;

    dailyTotals.set(
      dayTimestamp,
      (dailyTotals.get(dayTimestamp) ?? 0) + amount
    );
  }

  const daily = [...dailyTotals.entries()]
    .sort((a, b) => a[0] - b[0]);

  logger.debug('finished fetching earnings data')
  return {
    hourly,
    daily,

    // Preserves your existing behavior:
    // averages include only hours/days containing records.
    averageHourlyMilliSC: hourly.length
      ? totalMilliSC / hourly.length
      : 0,

    averageDailyMilliSC: daily.length
      ? totalMilliSC / daily.length
      : 0,

    totalSC: totalMilliSC,
    from: from.toISOString(),
    to: to.toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function refreshEarningsCache() {
  if (earningsRefreshRunning) return;

  earningsRefreshRunning = true;
  const startedAt = Date.now();

  try {
    const data = await fetchEarningsData();

    // Replace only after the entire refresh succeeds.
    globalThis.earningsCache = data;

    logger.info({
      event: 'earnings-cache-refreshed',
      ms: Date.now() - startedAt,
      hourlyBuckets: data.hourly.length,
      dailyBuckets: data.daily.length
    });
  } catch (error) {
    logger.error('Earnings cache refresh failed', error.message);
    // The last successful cache remains available.
  } finally {
    earningsRefreshRunning = false;
  }
}

app.get('/api/earnings', (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (globalThis.earningsCache === null) {
    res.set('Retry-After', '30');

    return res.status(503).json({
      error: 'Earnings data is not available yet. Please retry shortly.'
    });
  }

  return res.json(globalThis.earningsCache);
});

// Populate immediately without blocking server startup.
void refreshEarningsCache();

// Refresh every hour while this process is running.
const earningsRefreshTimer = setInterval(() => {
  void refreshEarningsCache();
}, HOUR_MS);

earningsRefreshTimer.unref();