import assert from 'node:assert/strict';
import crypto from 'node:crypto';

function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function evaluatePlayBoundary(lat, lng, boundary) {
  const distanceFromCenter = calculateDistanceMeters(lat, lng, boundary.lat, boundary.lng);
  const isOutside = distanceFromCenter > boundary.radiusMeters;
  const outsideMeters = isOutside ? Math.max(1, Math.round(distanceFromCenter - boundary.radiusMeters)) : 0;
  return {
    distanceMeters: Math.round(distanceFromCenter),
    outsideMeters,
    isOutside,
  };
}

function validateRealDeviceGps(coords, boundaryCenter) {
  if (coords.isManualFallback) {
    return { valid: false, reason: 'Manual or simulated location is disabled' };
  }
  if (
    !Number.isFinite(coords.lat) ||
    !Number.isFinite(coords.lng) ||
    !Number.isFinite(coords.accuracy) ||
    coords.lat < -90 ||
    coords.lat > 90 ||
    coords.lng < -180 ||
    coords.lng > 180 ||
    coords.accuracy <= 0 ||
    coords.accuracy > 2500
  ) {
    return { valid: false, reason: 'Invalid or low-confidence GPS coordinates' };
  }
  const distFromCenter = calculateDistanceMeters(coords.lat, coords.lng, boundaryCenter.lat, boundaryCenter.lng);
  if (distFromCenter > 25000) {
    return { valid: false, reason: 'Outside 25km operational area' };
  }
  return { valid: true };
}

function validateNickname(nickname) {
  const clean = String(nickname || '').trim();
  return clean.length >= 3 && clean.length <= 15;
}

function csprngAssignRoles(participantIds, hunterCount) {
  const shuffled = [...participantIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const roles = new Map();
  shuffled.forEach((id, idx) => roles.set(id, idx < hunterCount ? 'HUNTER' : 'HIDER'));
  return roles;
}

const auiCenter = { lat: 33.5395, lng: -5.1058, radiusMeters: 260 };
assert.equal(calculateDistanceMeters(auiCenter.lat, auiCenter.lng, auiCenter.lat, auiCenter.lng), 0);

// Boundary check tests
const insideCheck = evaluatePlayBoundary(33.5395, -5.1058, auiCenter);
assert.equal(insideCheck.isOutside, false);
assert.equal(insideCheck.outsideMeters, 0);

const outsideCheck = evaluatePlayBoundary(33.5435, -5.1058, auiCenter);
assert.equal(outsideCheck.isOutside, true);
assert.ok(outsideCheck.outsideMeters > 0);

// Anti-cheat GPS validation tests
assert.equal(
  validateRealDeviceGps({ lat: 33.5396, lng: -5.1059, accuracy: 12, isManualFallback: false }, auiCenter).valid,
  true
);
assert.equal(
  validateRealDeviceGps({ lat: 33.5396, lng: -5.1059, accuracy: 12, isManualFallback: true }, auiCenter).valid,
  false
);
assert.equal(
  validateRealDeviceGps({ lat: 33.5396, lng: -5.1059, accuracy: 5000 }, auiCenter).valid,
  false
);
assert.equal(
  validateRealDeviceGps({ lat: 34.0209, lng: -6.8416, accuracy: 10 }, auiCenter).valid,
  false
);

// Nickname validation tests (3 to 15 chars)
assert.equal(validateNickname('ab'), false);
assert.equal(validateNickname('Ali'), true);
assert.equal(validateNickname('Youssef'), true);
assert.equal(validateNickname('123456789012345'), true);
assert.equal(validateNickname('1234567890123456'), false);

// Role assignment tests
const roles = csprngAssignRoles(['p1', 'p2', 'p3', 'p4'], 1);
assert.equal(Array.from(roles.values()).filter((r) => r === 'HUNTER').length, 1);

console.log('✓ All AUI Manhunt Production v1.0 automated tests passed!');
