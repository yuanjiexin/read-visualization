import type { Config, Context } from "@netlify/functions";

const DEFAULT_GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway";
const DEFAULT_SKILL_VERSION = "1.0.5";
const GATEWAY_TIMEOUT_MS = 55_000;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return jsonResponse({ errcode: 405, errmsg: "Method not allowed" }, { status: 405 });
  }

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return jsonResponse({ errcode: -1, errmsg: "Invalid JSON body" }, { status: 400 });
  }

  const { targetUrl, skillUrl, apiKey, api_name, skill_version, ...otherParams } = payload as Record<string, any>;
  if (!apiKey) {
    return jsonResponse({ errcode: -1, errmsg: "API Key (Bearer Token) is required" }, { status: 400 });
  }

  const requestBody = {
    api_name: api_name || "/_list",
    skill_version: skill_version || DEFAULT_SKILL_VERSION,
    ...(skillUrl ? { skill_url: skillUrl } : {}),
    ...otherParams
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl || DEFAULT_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return jsonResponse(await response.json(), { status: response.status });
    }

    const text = await response.text();
    return jsonResponse({
      errcode: response.ok ? 0 : response.status,
      errmsg: text || `WeRead gateway returned ${response.status}`
    }, { status: response.status });
  } catch (error: any) {
    const message = error?.name === "AbortError"
      ? `Proxy request timed out after ${Math.round(GATEWAY_TIMEOUT_MS / 1000)} seconds`
      : error?.message || String(error);
    return jsonResponse({ errcode: 500, errmsg: `Proxy request failed: ${message}` }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
};

export const config: Config = {
  path: "/api/weread/proxy"
};
