import type { Config, Context } from "@netlify/functions";
import { callConfiguredAnalysisApi, jsonResponse } from "./_shared/analysis.mjs";

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed" }, { status: 405 });
  }

  const body = await req.json().catch(() => ({}));
  const analysisConfig = body?.analysisConfig;

  try {
    await callConfiguredAnalysisApi(
      analysisConfig,
      '请只返回严格 JSON：{"ok":true,"message":"pong"}'
    );
    return jsonResponse({ ok: true, model: analysisConfig?.model || "未命名模型" });
  } catch (error: any) {
    return jsonResponse({
      ok: false,
      model: analysisConfig?.model || "未命名模型",
      message: error?.message || "分析模型连接失败"
    }, { status: 502 });
  }
};

export const config: Config = {
  path: "/api/analysis/test"
};
