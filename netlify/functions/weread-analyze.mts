import type { Config, Context } from "@netlify/functions";
import {
  buildReadingAnalysisPrompt,
  callConfiguredAnalysisApi,
  completeAnalysisYears,
  getRequiredAnalysisYears,
  jsonResponse
} from "./_shared/analysis.mjs";

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await req.json().catch(() => ({}));
  const books = Array.isArray(body?.books) ? body.books : [];
  const highlights = Array.isArray(body?.highlights) ? body.highlights : [];
  const analysisConfig = body?.analysisConfig;

  if (books.length === 0) {
    return jsonResponse({ error: "Missing books list for analysis" }, { status: 400 });
  }
  if (!analysisConfig?.endpoint || !analysisConfig?.apiKey || !analysisConfig?.model) {
    return jsonResponse({ error: "缺少分析模型配置" }, { status: 400 });
  }

  try {
    const rawAnalysis = await callConfiguredAnalysisApi(
      analysisConfig,
      buildReadingAnalysisPrompt(books, highlights)
    );
    const result = completeAnalysisYears(rawAnalysis, getRequiredAnalysisYears(books), books, highlights);
    return jsonResponse({
      ...result,
      isAiGenerated: true,
      analysisModel: analysisConfig.model,
      analysisProvider: "configured"
    });
  } catch (error: any) {
    return jsonResponse({
      error: error?.message || "分析模型连接失败"
    }, { status: 502 });
  }
};

export const config: Config = {
  path: "/api/weread/analyze"
};
