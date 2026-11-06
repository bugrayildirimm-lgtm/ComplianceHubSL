import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicy, isPublicAddress, hostAllowed, validateUrl, validateResolvedAddresses } from '../src/policy.js';

const policy = createPolicy({ approvedHosts: ['gamblingcommission.gov.uk', '.gov.mt'], allowedPorts: [443] });

test('public addresses are accepted', () => {
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

test('private, loopback, link-local, metadata and reserved addresses are refused', () => {
  for (const ip of ['127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.4.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '64:ff9b::a00:1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test('approved host matching is exact or suffix-scoped', () => {
  assert.equal(hostAllowed('gamblingcommission.gov.uk', policy.approvedHosts), true);
  assert.equal(hostAllowed('www.gamblingcommission.gov.uk', policy.approvedHosts), false);
  assert.equal(hostAllowed('mga.gov.mt', policy.approvedHosts), true);
  assert.equal(hostAllowed('notgov.mt.evil.example', policy.approvedHosts), false);
});

test('only https on a permitted port to a named host is allowed', () => {
  assert.equal(validateUrl('https://gamblingcommission.gov.uk/publications', { mode: 'monitoring', policy }).ok, true);
  assert.equal(validateUrl('http://gamblingcommission.gov.uk/', { mode: 'monitoring', policy }).code, 'SCHEME_NOT_PERMITTED');
  assert.equal(validateUrl('file:///etc/passwd', { mode: 'monitoring', policy }).code, 'SCHEME_NOT_PERMITTED');
  assert.equal(validateUrl('https://user:pass@gamblingcommission.gov.uk/', { mode: 'monitoring', policy }).code, 'USERINFO_NOT_PERMITTED');
  assert.equal(validateUrl('https://127.0.0.1/', { mode: 'monitoring', policy }).code, 'IP_LITERAL_NOT_PERMITTED');
  assert.equal(validateUrl('https://gamblingcommission.gov.uk:8443/', { mode: 'monitoring', policy }).code, 'PORT_NOT_PERMITTED');
  assert.equal(validateUrl('https://unapproved.example/', { mode: 'monitoring', policy }).code, 'HOST_NOT_APPROVED');
});

test('candidate mode skips the allowlist but still enforces scheme, port and address rules', () => {
  assert.equal(validateUrl('https://newregulator.example/publications', { mode: 'candidate', policy }).ok, true);
  assert.equal(validateUrl('http://newregulator.example/', { mode: 'candidate', policy }).code, 'SCHEME_NOT_PERMITTED');
  assert.equal(validateUrl('https://10.0.0.5/', { mode: 'candidate', policy }).code, 'IP_LITERAL_NOT_PERMITTED');
});

test('a single non-public answer refuses the whole resolution', () => {
  const good = validateResolvedAddresses([{ address: '93.184.216.34', family: 4 }], { policy });
  assert.equal(good.ok, true);
  const mixed = validateResolvedAddresses([{ address: '93.184.216.34', family: 4 }, { address: '10.1.1.1', family: 4 }], { policy });
  assert.equal(mixed.ok, false);
  assert.equal(mixed.code, 'DESTINATION_NOT_PUBLIC');
  assert.equal(validateResolvedAddresses([], { policy }).code, 'RESOLUTION_FAILED');
});