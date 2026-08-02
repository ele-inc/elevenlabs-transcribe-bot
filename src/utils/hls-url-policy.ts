/** HLS URL のホストが API 用許可リストに含まれるかを判定する。 */
export function isAllowedHlsApiUrl(
  url: string,
  allowedHosts: string[],
): boolean {
  let hostname: string;
  try {
    hostname = normalizeHostname(new URL(url).hostname);
  } catch {
    return false;
  }

  if (isPrivateOrLocalHostname(hostname)) return false;
  return allowedHosts.some((entry) => {
    const allowed = normalizeHostname(entry.replace(/^\*\./, ""));
    return Boolean(allowed) &&
      (hostname === allowed || hostname.endsWith(`.${allowed}`));
  });
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(
    /\.$/,
    "",
  );
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  if (
    hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname === "::1" ||
    hostname.startsWith("fc") || hostname.startsWith("fd") ||
    /^fe[89ab]/.test(hostname)
  ) {
    return true;
  }

  const ipv4Text = hostname.startsWith("::ffff:")
    ? hostname.slice("::ffff:".length)
    : hostname;
  const octets = ipv4Text.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) || first >= 224;
}
