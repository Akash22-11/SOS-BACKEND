/**
 * Tests for POST /api/sos/trigger
 *
 * These are integration-style tests using supertest.
 * They mock the DB models and notification service so no real
 * network calls are made.
 */


const request  = require('supertest');
const app      = require('../src/app');
const sosService = require('../src/services/sosService');
const { signToken } = require('../src/middleware/auth');

// ── Mock the heavy services ───────────────────────────────────────────────────

jest.mock('../src/services/sosService');
jest.mock('../src/utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Mock auth middleware to inject a fake user
jest.mock('../src/middleware/auth', () => {
  const original = jest.requireActual('../src/middleware/auth');
  return {
    ...original,
    protectUser: (req, _res, next) => {
      req.user = { id: 'user123', name: 'Test User', phone: '+910000000000' };
      next();
    }
  };
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/sos/trigger', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 201 and alerted hospitals on success', async () => {
    sosService.triggerSOS.mockResolvedValue({
      sosEvent:        { _id: 'event001', createdAt: new Date() },
      alertedHospitals: [
        { name: 'City Hospital', phone: '+910000000001', address: '1 MG Road', distanceMeters: 1200 }
      ],
      duplicate: false
    });

    const res = await request(app)
      .post('/api/sos/trigger')
      .send({ latitude: 23.4, longitude: 88.5 });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.alertedHospitals).toHaveLength(1);
    expect(res.body.alertedHospitals[0].name).toBe('City Hospital');
  });

  test('returns 409 when user already has active SOS', async () => {
    sosService.triggerSOS.mockResolvedValue({
      sosEvent:  { _id: 'event002' },
      duplicate: true
    });

    const res = await request(app)
      .post('/api/sos/trigger')
      .send({ latitude: 23.4, longitude: 88.5 });

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 on invalid coordinates', async () => {
    const res = await request(app)
      .post('/api/sos/trigger')
      .send({ latitude: 'abc', longitude: 88.5 });

    expect(res.statusCode).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  test('returns 500 when service throws', async () => {
    sosService.triggerSOS.mockRejectedValue(new Error('DB down'));

    const res = await request(app)
      .post('/api/sos/trigger')
      .send({ latitude: 23.4, longitude: 88.5 });

    expect(res.statusCode).toBe(500);
  });
});

describe('POST /api/sos/:id/cancel', () => {
  test('returns 200 on successful cancel', async () => {
    sosService.cancelSOS.mockResolvedValue({ _id: 'event001', status: 'cancelled' });

    const res = await request(app)
      .post('/api/sos/event001/cancel');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('returns 404 when SOS not found', async () => {
    sosService.cancelSOS.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/sos/nonexistent/cancel');

    expect(res.statusCode).toBe(404);
  });
});
