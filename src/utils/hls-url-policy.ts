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

/**
 * 実際の HLS 取得直前に、許可ホストとDNS解決結果の両方を検証する。
 * リダイレクト、子マニフェスト、鍵、セグメントの各URLで呼び出す。
 */
export async function assertAllowedHlsFetchUrl(
  url: string,
  allowedHosts: string[],
  resolveDns: (
    hostname: string,
    recordType: "A" | "AAAA",
  ) => Promise<string[]> = (hostname, recordType) =>
    Deno.resolveDns(hostname, recordType),
): Promise<void> {
  if (!isAllowedHlsApiUrl(url, allowedHosts)) {
    throw new Error(`許可されていないHLS取得先です: ${url}`);
  }

  const hostname = normalizeHostname(new URL(url).hostname);
  if (hostname.includes(":") || isIpv4Address(hostname)) return;

  const addresses = (
    await Promise.all([
      resolveAddresses(hostname, "A", resolveDns),
      resolveAddresses(hostname, "AAAA", resolveDns),
    ])
  ).flat();
  if (addresses.length === 0) {
    throw new Error(`HLS取得先のDNS解決結果を確認できません: ${url}`);
  }
  if (addresses.some(isPrivateOrLocalHostname)) {
    throw new Error(
      `HLS取得先がローカルまたはプライベートIPを指しています: ${url}`,
    );
  }
}

async function resolveAddresses(
  hostname: string,
  recordType: "A" | "AAAA",
  resolveDns: (
    hostname: string,
    recordType: "A" | "AAAA",
  ) => Promise<string[]>,
): Promise<string[]> {
  try {
    return await resolveDns(hostname, recordType);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
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
    hostname.endsWith(".local")
  ) {
    return true;
  }

  if (hostname.includes(":")) {
    if (
      hostname === "::" || hostname === "::1" ||
      hostname === "0:0:0:0:0:0:0:0" ||
      hostname === "0:0:0:0:0:0:0:1" ||
      hostname.startsWith("fc") || hostname.startsWith("fd") ||
      /^fe[89ab]/.test(hostname)
    ) {
      return true;
    }
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

function isIpv4Address(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  return octets.length === 4 &&
    octets.every((octet) =>
      Number.isInteger(octet) && octet >= 0 && octet <= 255
    );
}
