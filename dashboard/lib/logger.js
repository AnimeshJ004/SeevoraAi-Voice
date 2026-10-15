/**
 * SeevoraVoice (RapidX Voice) - Structured Observability & Production Logger
 *
 * Zero external dependencies (pure Node.js).
 * - High-performance structured NDJSON output in production (Datadog/CloudWatch/GCP compatible)
 * - Human-readable clean output in local development
 * - Request-scoped tracing via X-Request-Id correlation IDs
 * - Global uncaughtException and unhandledRejection safety traps
 * - In-memory Prometheus/JSON metrics tracking (uptime, memory, requests, latency, active WebSockets)
 */
'use strict';

const crypto = require('crypto');

const IS_PROD = process.env.NODE_ENV === 'production';
const LOG_LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40, FATAL: 50 };
const CURRENT_LEVEL = LOG_LEVELS[String(process.env.LOG_LEVEL || (IS_PROD ? 'INFO' : 'DEBUG')).toUpperCase()] || LOG_LEVELS.INFO;

// Metrics Store
const metrics = {
  startTime: Date.now(),
  requestsTotal: 0,
  requestsByStatus: {},
  errorsTotal: 0,
  activeWebSockets: 0,
  callsInitiatedTotal: 0,
};

function formatError(err) {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code || err.status,
    };
  }
  return { message: String(err) };
}

function writeLog(levelName, message, context = {}) {
  const levelNum = LOG_LEVELS[levelName] || LOG_LEVELS.INFO;
  if (levelNum < CURRENT_LEVEL) return;

  const now = new Date().toISOString();
  const reqId = context.reqId || context.requestId || undefined;
  const tenantId = context.tenantId || undefined;
  const error = formatError(context.err || context.error);

  if (IS_PROD) {
    // Structured JSON for log aggregators (CloudWatch, Datadog, Grafana Loki, ELK)
    const entry = {
      timestamp: now,
      level: levelName,
      message: String(message),
      reqId,
      tenantId,
      route: context.route,
      method: context.method,
      statusCode: context.statusCode,
      latencyMs: context.latencyMs,
      error,
      metadata: context.metadata,
    };
    // Strip undefined keys
    Object.keys(entry).forEach((k) => entry[k] === undefined && delete entry[k]);
    process.stdout.write(JSON.stringify(entry) + '\n');
  } else {
    // Pretty human-readable terminal format for local development
    const colors = {
      DEBUG: '\x1b[90m',
      INFO: '\x1b[36m',
      WARN: '\x1b[33m',
      ERROR: '\x1b[31m',
      FATAL: '\x1b[35m',
    };
    const reset = '\x1b[0m';
    const color = colors[levelName] || reset;
    const tag = `${color}[${levelName}]${reset}`;
    const idTag = reqId ? ` \x1b[90m(${reqId.slice(0, 8)})${reset}` : '';
    const errText = error ? `\n  ${color}${error.stack || error.message}${reset}` : '';
    console.log(`${tag}${idTag} ${message}${errText}`);
  }
}

const logger = {
  debug: (msg, ctx) => writeLog('DEBUG', msg, ctx),
  info: (msg, ctx) => writeLog('INFO', msg, ctx),
  warn: (msg, ctx) => writeLog('WARN', msg, ctx),
  error: (msg, ctx) => {
    metrics.errorsTotal++;
    writeLog('ERROR', msg, ctx);
  },
  fatal: (msg, ctx) => {
    metrics.errorsTotal++;
    writeLog('FATAL', msg, ctx);
  },

  // Generates or validates request correlation ID
  getRequestId: (req) => {
    const existing = req.headers['x-request-id'] || req.headers['x-correlation-id'];
    if (existing && typeof existing === 'string' && existing.length < 128) {
      return existing;
    }
    return crypto.randomUUID();
  },

  // Metrics Collectors
  recordRequest: (method, route, statusCode, durationMs) => {
    metrics.requestsTotal++;
    const bucket = `${Math.floor(statusCode / 100)}xx`;
    metrics.requestsByStatus[bucket] = (metrics.requestsByStatus[bucket] || 0) + 1;
  },

  recordWebSocketOpen: () => { metrics.activeWebSockets++; },
  recordWebSocketClose: () => { metrics.activeWebSockets = Math.max(0, metrics.activeWebSockets - 1); },
  recordCallInitiated: () => { metrics.callsInitiatedTotal++; },

  getMetrics: () => {
    const mem = process.memoryUsage();
    return {
      status: 'ok',
      service: 'seevoravoice-api',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      },
      telemetry: {
        totalRequests: metrics.requestsTotal,
        requestsByStatus: metrics.requestsByStatus,
        totalErrors: metrics.errorsTotal,
        activeWebSockets: metrics.activeWebSockets,
        totalCallsInitiated: metrics.callsInitiatedTotal,
      },
    };
  },
};

// In production, redirect standard console methods to structured logger so nothing bypasses NDJSON formatting
if (IS_PROD) {
  console.log = (...args) => writeLog('INFO', args.map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' '));
  console.warn = (...args) => writeLog('WARN', args.map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' '));
  console.error = (...args) => {
    metrics.errorsTotal++;
    writeLog('ERROR', args.map((a) => (typeof a === 'object' && a !== null ? (a.stack || JSON.stringify(a)) : String(a))).join(' '));
  };
}

// Global Safety Traps: Log crashes with context instead of silent exits
process.on('uncaughtException', (err) => {
  logger.fatal('Uncaught Exception occurred in application process', { error: err });
  if (IS_PROD) {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection detected', { error: reason });
});

module.exports = logger;
