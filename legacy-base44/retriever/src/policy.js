// Destination policy. Every hop is revalidated here before any connection is attempted.
import net from 'node:net';

const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
];

const v4ToInt = (ip) => ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;

function ipv4Blocked(ip) {
  const asInt = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (asInt & mask) === (v4ToInt(base) & mask);
  });
}

function parseIPv6(rawIp) {
  let ip = rawIp.split('%')[0];
  // A trailing dotted quad (::ffff:127.0.0.1) is two groups, not one.
  const dotted = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    ip = `${ip.slice(0, ip.length - dotted[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const group of groups) {
    const value = parseInt(group, 16);
    if (!Number.isFinite(value) || value < 0 || value > 0xffff) return null;
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function ipv6Blocked(ip) {
  const bytes = parseIPv6(ip);
  if (!bytes) return true;
  const embeddedV4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
  const allZeroPrefix = (count) => bytes.slice(0, count).every((b) => b === 0);
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::) carry a v4 destination: judge the v4 address.
  if (allZeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) return ipv4Blocked(embeddedV4);
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) return ipv4Blocked(embeddedV4);
  if (allZeroPrefix(15) && bytes[15] <= 1) return true; // :: and ::1
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // 2001:db8::/32
  return false;
}

export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !ipv4Blocked(address);
  if (family === 6) return !ipv6Blocked(address);
  return false;
}

export function hostAllowed(hostname, approvedHosts) {
  const host = String(hostname).toLowerCase();
  return approvedHosts.some((entry) => (entry.startsWith('.') ? host.endsWith(entry) || host === entry.slice(1) : host === entry));
}

// allowPrivateForTest exists so the connection-pinning path can be exercised against a local
// TLS server. It is never populated by loadConfig(), so production cannot enable it.
export function createPolicy({ approvedHosts = [], allowedPorts = [443], allowPrivateForTest = false } = {}) {
  return { approvedHosts, allowedPorts, allowPrivateForTest };
}

export function validateUrl(rawUrl, { mode, policy }) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return { ok: false, code: 'INVALID_URL', message: 'URL could not be parsed.' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, code: 'SCHEME_NOT_PERMITTED', message: 'Only https destinations are permitted.' };
  if (parsed.username || parsed.password) return { ok: false, code: 'USERINFO_NOT_PERMITTED', message: 'Credentials in the URL are not permitted.' };
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) return { ok: false, code: 'INVALID_URL', message: 'URL has no hostname.' };
  if (net.isIP(hostname)) return { ok: false, code: 'IP_LITERAL_NOT_PERMITTED', message: 'Address literals are not permitted; an official hostname is required for provenance.' };
  const port = parsed.port ? Number(parsed.port) : 443;
  if (mode === 'monitoring' && !hostAllowed(hostname, policy.approvedHosts)) {
    return { ok: false, code: 'HOST_NOT_APPROVED', message: 'Hostname is not on the approved official-source list. Verify the source and add its host before monitoring it.' };
  }
  if (!policy.allowedPorts.includes(port)) return { ok: false, code: 'PORT_NOT_PERMITTED', message: `Port ${port} is not permitted.` };
  parsed.hash = '';
  return { ok: true, url: parsed.toString(), hostname, port };
}

export function validateResolvedAddresses(addresses, { policy }) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return { ok: false, code: 'RESOLUTION_FAILED', message: 'No address answers for this hostname.' };
  }
  const rejected = addresses.filter((a) => !isPublicAddress(a.address) && !policy.allowPrivateForTest);
  if (rejected.length) {
    return { ok: false, code: 'DESTINATION_NOT_PUBLIC', message: 'Hostname resolves to a non-public address; connection refused.' };
  }
  const chosen = addresses.find((a) => a.family === 4) || addresses[0];
  return { ok: true, address: chosen.address, family: chosen.family };
}