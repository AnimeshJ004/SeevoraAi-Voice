/**
 * Observability, Health & Telemetry Tests
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const logger = require('../lib/logger');

test('Logger generates valid UUID request IDs and tracks metrics', () => {
  const req = { headers: {} };
  const reqId = logger.getRequestId(req);
  assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reqId));

  // Existing header is respected
  const existingReq = { headers: { 'x-request-id': 'custom-trace-id-123' } };
  assert.equal(logger.getRequestId(existingReq), 'custom-trace-id-123');

  // Metrics telemetry
  logger.recordRequest('GET', '/api/test', 200, 15);
  logger.recordWebSocketOpen();
  logger.recordWebSocketClose();

  const metrics = logger.getMetrics();
  assert.equal(metrics.status, 'ok');
  assert.ok(metrics.uptimeSeconds >= 0);
  assert.ok(metrics.memory.rssMb > 0);
  assert.ok(metrics.telemetry.totalRequests >= 1);
  assert.equal(metrics.telemetry.activeWebSockets, 0);
});
