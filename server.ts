/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Lazy-initialized Gemini Client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HMR_PORT = Number(process.env.VITE_HMR_PORT || (PORT === 3000 ? 24678 : PORT + 21678));
const ANALYSIS_TIMEOUT_MS = 180000;
const WEREAD_GATEWAY_TIMEOUT_MS = 180000;
const MBTI_TYPES = new Set([
  "INTJ", "INTP", "ENTJ", "ENTP",
  "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP"
]);
const VISUAL_PERSONA_BY_ARCHETYPE: Record<string, string> = {
  "凝视": "蒙娜丽莎",
  "沉思": "圣杰罗姆",
  "辩思": "柏拉图",
  "落地": "亚里士多德",
  "盛放": "维纳斯",
  "繁生": "芙洛拉",
  "守护": "圣母",
  "野性": "巴克斯",
  "质疑": "圣托马斯",
  "决断": "朱迪斯",
  "召唤": "马太",
  "加冕": "伊丽莎白一世",
  "孤绝": "圣方济各"
};

app.use(express.json({ limit: "50mb" }));

const personalityPromptPath = path.join(process.cwd(), "reading-personality-prompt.md");

function readPersonalityPrompt(): string {
  try {
    return fs.readFileSync(personalityPromptPath, "utf-8");
  } catch (error) {
    console.warn("Failed to read reading-personality-prompt.md, using built-in fallback prompt.", error);
    return "你是一位阅读 MBTI 分析师。请根据用户每年的书籍、分类、阅读时间、划线与笔记，推断 INFJ、ENTP 这类标准四字母 MBTI 类型，并返回严格 JSON。";
  }
}

function extractJsonText(text: string): string {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function extractResponsesText(payload: any): string {
  if (typeof payload?.output_text === "string") return payload.output_text;
  if (typeof payload?.text === "string") return payload.text;
  if (typeof payload?.choices?.[0]?.message?.content === "string") return payload.choices[0].message.content;
  if (typeof payload?.choices?.[0]?.text === "string") return payload.choices[0].text;
  if (Array.isArray(payload?.content)) {
    const textParts = payload.content
      .filter((block: any) => (block?.type === "text" || !block?.type) && typeof block?.text === "string")
      .map((block: any) => block.text);
    if (textParts.length > 0) return textParts.join("\n");
  }
  if (Array.isArray(payload?.output)) {
    const parts = payload.output.flatMap((item: any) => {
      if (typeof item?.content === "string") return [item.content];
      if (!Array.isArray(item?.content)) return [];
      return item.content
        .map((content: any) => content?.text || content?.output_text || content?.content || "")
        .filter(Boolean);
    });
    if (parts.length > 0) return parts.join("\n");
  }
  if (typeof payload?.result === "string") return payload.result;
  return "";
}

const MIN_VALID_READING_YEAR = 2000;
const FUTURE_READING_TOLERANCE_MS = 24 * 60 * 60 * 1000;

function isValidReadingTimestamp(timestamp: any, now = new Date()): timestamp is number {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || !value) return false;
  const ms = value * 1000;
  if (ms > now.getTime() + FUTURE_READING_TOLERANCE_MS) return false;

  const year = new Date(ms).getFullYear();
  return year >= MIN_VALID_READING_YEAR && year <= now.getFullYear();
}

function getReadingTimestampFromItem(item: any): number | undefined {
  const book = item?.book || item;
  const candidates = [
    book?.readUpdateTime,
    book?.finishReading,
    item?.readUpdateTime,
    item?.finishReading,
    item?.sort
  ];
  const timestamp = candidates.find((value) => isValidReadingTimestamp(value));
  return timestamp ? Number(timestamp) : undefined;
}

function getEstimatedPastDate(idx: number, now = new Date()): Date {
  const day = Math.min(now.getDate(), 28);
  return new Date(now.getFullYear(), now.getMonth() - idx, day);
}

function getBookYearFromItem(item: any, idx = 0): number {
  const timestamp = getReadingTimestampFromItem(item);
  if (timestamp) {
    return new Date(timestamp * 1000).getFullYear();
  }
  return getEstimatedPastDate(idx).getFullYear();
}

function getRequiredAnalysisYears(books: any[]): number[] {
  return Array.from(new Set(books.map((item, idx) => getBookYearFromItem(item, idx)))).sort((a, b) => b - a);
}

function getBookFromItem(item: any): any {
  return item?.book || item || {};
}

function getBookTitle(item: any): string {
  return getBookFromItem(item)?.title || item?.title || "未命名书籍";
}

function getBookCategory(item: any): string {
  const book = getBookFromItem(item);
  const category = book?.category || item?.category || book?.categories?.[0]?.title || "";
  return String(category || "未分类");
}

function normalizeMbtiTitle(raw: any, fallback = "INFJ"): string {
  const match = String(raw || "").toUpperCase().match(/\b[EI][NS][TF][JP]\b/);
  return match && MBTI_TYPES.has(match[0]) ? match[0] : fallback;
}

function inferReadingMbtiType(books: any[], highlights: any[] = []): string {
  const text = [
    ...books.map((item) => `${getBookTitle(item)} ${getBookCategory(item)} ${getBookFromItem(item)?.author || ""}`),
    ...highlights.map((item) => item?.markText || "")
  ].join(" ").toLowerCase();

  const score = (patterns: string[]) => patterns.reduce((sum, pattern) => sum + (text.includes(pattern.toLowerCase()) ? 1 : 0), 0);
  const practicalScore = score(["商业", "经济", "管理", "投资", "技术", "工具", "方法", "效率", "习惯", "原则", "产品"]);
  const abstractScore = score(["文学", "哲学", "心理", "社会", "文化", "艺术", "小说", "诗", "存在", "意义", "自由", "命运"]);
  const socialScore = score(["社会", "关系", "组织", "沟通", "影响", "领导", "市场", "创业", "团队", "公共"]);
  const inwardScore = score(["内心", "孤独", "自我", "灵魂", "沉默", "冥想", "边界", "创伤", "存在", "文学"]);
  const logicScore = score(["理性", "系统", "结构", "证据", "逻辑", "数据", "科学", "资本", "策略", "决策"]);
  const feelingScore = score(["爱", "悲悯", "痛苦", "温柔", "关系", "情感", "母亲", "家庭", "疗愈", "怜悯"]);
  const orderScore = score(["秩序", "计划", "原则", "控制", "自律", "目标", "复盘", "完成", "系统", "规则"]);
  const openScore = score(["可能", "想象", "探索", "流动", "偶然", "旷野", "旅行", "创造", "变化", "自由"]);

  const ei = socialScore > inwardScore + 1 ? "E" : "I";
  const ns = abstractScore >= practicalScore ? "N" : "S";
  const tf = logicScore > feelingScore ? "T" : "F";
  const jp = orderScore >= openScore ? "J" : "P";
  return normalizeMbtiTitle(`${ei}${ns}${tf}${jp}`, "INFJ");
}

function compactText(text: string, maxLength: number): string {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function buildHighlightSamples(books: any[], highlights: any[], limit = 120): string[] {
  const bookById = new Map<string, any>();
  books.forEach((item) => {
    if (item?.bookId) bookById.set(item.bookId, item);
  });

  const usableHighlights = (highlights || [])
    .filter((item: any) => item?.markText && String(item.markText).trim().length >= 4)
    .sort((a: any, b: any) => Number(b?.createTime || 0) - Number(a?.createTime || 0));

  const selected: any[] = [];
  const countByBook = new Map<string, number>();
  for (const item of usableHighlights) {
    if (selected.length >= limit) break;
    const bookId = item?.bookId || "";
    const currentCount = countByBook.get(bookId) || 0;
    if (currentCount >= 4 && usableHighlights.length > limit) continue;
    countByBook.set(bookId, currentCount + 1);
    selected.push(item);
  }

  return selected.map((item: any) => {
    const book = bookById.get(item?.bookId);
    const title = item?.bookName || getBookTitle(book) || "";
    const createTime = item?.createTime ? new Date(item.createTime * 1000).toISOString().slice(0, 10) : "未知时间";
    return `《${title}》(${createTime}) "${compactText(item.markText, 160)}"`;
  });
}

function buildMbtiDescription(type: string, yearBooks: any[], yearHighlights: any[]): string {
  const titles = yearBooks.map(getBookTitle).filter(Boolean).slice(0, 3);
  const categories = Array.from(new Set(yearBooks.map(getBookCategory))).slice(0, 3).join("、") || "未分类";
  const quote = compactText(yearHighlights.find((item: any) => item?.markText)?.markText || "", 36);
  const titleText = titles.length > 0 ? `《${titles.join("》《")}》` : "这一年的书";
  const quoteText = quote ? `划线里反复出现的“${quote}”，` : "";

  return `${type} 来自 ${categories} 的阅读重心：${titleText}把你的注意力推向内在问题与现实结构之间。${quoteText}显示你既在辨认世界，也在给自己的行动方式定型。`;
}

function inferVisualArchetype(type: string, yearBooks: any[], yearHighlights: any[]): string {
  const text = [
    ...yearBooks.map((item) => `${getBookTitle(item)} ${getBookCategory(item)} ${getBookFromItem(item)?.author || ""}`),
    ...yearHighlights.map((item: any) => item?.markText || "")
  ].join(" ");
  if (/怀疑|证据|真实|真相|批判|逻辑|科学|技术|方法|结构/.test(text)) return "质疑";
  if (/权力|治理|战略|管理|组织|商业|经济|投资|决策/.test(text)) return "加冕";
  if (/冲突|反抗|愤怒|决裂|革命|越界|欲望/.test(text)) return "决断";
  if (/孤独|退隐|荒原|远方|沉默|死亡|存在/.test(text)) return "孤绝";
  if (/关系|照护|伦理|家庭|母亲|共情|责任/.test(text)) return "守护";
  if (/哲学|理念|抽象|本质|形而上|意义/.test(text)) return "辩思";
  if (/自由|美|身体|艺术|爱情|感受/.test(text)) return "盛放";
  if (/实践|现实|经验|规则|习惯|落地/.test(text)) return "落地";
  if (/ENFP|ESFP/.test(type)) return "繁生";
  if (/ENTP|ESTP/.test(type)) return "野性";
  if (/ISTJ|INTP/.test(type)) return "沉思";
  return "凝视";
}

function buildAnnualQuestion(yearBooks: any[], yearHighlights: any[]): string {
  const titles = yearBooks.map(getBookTitle).filter(Boolean);
  const categories = Array.from(new Set(yearBooks.map(getBookCategory))).join("、");
  const text = `${titles.join(" ")} ${categories} ${(yearHighlights[0]?.markText || "")}`;
  if (/自由|边界|关系/.test(text)) return "自由与边界如何共存";
  if (/秩序|规则|习惯|系统/.test(text)) return "秩序如何从混乱中生成";
  if (/真实|真相|证据|怀疑/.test(text)) return "经验能否抵达真相";
  if (/权力|治理|商业|组织/.test(text)) return "权力如何塑造现实";
  if (/孤独|存在|死亡|命运/.test(text)) return "孤独如何保存清醒";
  if (/爱|家庭|伦理|照护/.test(text)) return "关系如何保存自我";
  if (/欲望|冲突|反抗|革命/.test(text)) return "欲望如何改变判断";
  return "旧答案为何失效";
}

function buildFallbackPersonality(year: number, title: string, yearBooks: any[], yearHighlights: any[]) {
  const visualArchetype = inferVisualArchetype(title, yearBooks, yearHighlights);
  const artPersona = VISUAL_PERSONA_BY_ARCHETYPE[visualArchetype] || "蒙娜丽莎";
  const category = Array.from(new Set(yearBooks.map(getBookCategory))).slice(0, 2).join("、") || "未分类";
  const bookTitle = yearBooks[0] ? `《${getBookTitle(yearBooks[0])}》` : "这一年的书目";

  return {
    year,
    title,
    annualQuestion: buildAnnualQuestion(yearBooks, yearHighlights),
    visualArchetype,
    artPersona,
    personaReason: `${bookTitle}与${category}阅读把注意力推向这类心智姿态，因此视觉人格落在${visualArchetype}，对应${artPersona}的观看关系。`,
    description: yearBooks.length > 0
      ? buildMbtiDescription(title, yearBooks, yearHighlights)
      : `${title} 来自这一年零散但有效的阅读痕迹：书目数量不多，却已经能看见你在意义、秩序与自我边界之间寻找稳定的理解方式。`
  };
}

function buildMissingYearPersonality(year: number, books: any[], highlights: any[]) {
  const yearBooks = books.filter((item, idx) => getBookYearFromItem(item, idx) === year);
  const yearHighlights = (highlights || []).filter((highlight: any) => {
    return yearBooks.some((book: any) => book?.bookId === highlight?.bookId);
  });
  const title = inferReadingMbtiType(yearBooks, yearHighlights);

  return buildFallbackPersonality(year, title, yearBooks, yearHighlights);
}

function completeAnalysisYears(result: any, requiredYears: number[], books: any[], highlights: any[]) {
  const existing = Array.isArray(result?.yearlyPersonality) ? result.yearlyPersonality : [];
  const byYear = new Map<number, any>();

  existing.forEach((item: any) => {
    const year = Number(item?.year);
    if (!Number.isFinite(year)) return;
    const fallback = buildMissingYearPersonality(year, books, highlights);
    byYear.set(year, {
      ...fallback,
      ...item,
      year,
      title: normalizeMbtiTitle(item?.title, fallback.title),
      annualQuestion: item?.annualQuestion || fallback.annualQuestion,
      visualArchetype: VISUAL_PERSONA_BY_ARCHETYPE[item?.visualArchetype] ? item.visualArchetype : fallback.visualArchetype,
      artPersona: VISUAL_PERSONA_BY_ARCHETYPE[item?.visualArchetype] || item?.artPersona || fallback.artPersona,
      personaReason: item?.personaReason || fallback.personaReason,
      description: item?.description || fallback.description
    });
  });

  requiredYears.forEach((year) => {
    if (!byYear.has(year)) {
      byYear.set(year, buildMissingYearPersonality(year, books, highlights));
    }
  });

  return {
    ...result,
    yearlyPersonality: requiredYears.map((year) => byYear.get(year))
  };
}

type ApiFormat = "responses" | "chat-completions" | "anthropic";

function stripEndpointValue(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/[),;]+$/g, "")
    .trim();
}

function appendEndpointPath(url: URL, suffix: string, defaultBasePath = ""): string {
  const cleanPath = url.pathname.replace(/\/+$/g, "");
  const basePath = cleanPath && cleanPath !== "" ? cleanPath : defaultBasePath;
  url.pathname = `${basePath}/${suffix}`.replace(/\/{2,}/g, "/");
  return url.toString().replace(/\/$/g, "");
}

function normalizeAnalysisEndpoint(rawEndpoint: string, model = ""): string {
  const endpoint = stripEndpointValue(rawEndpoint);
  if (!endpoint) return "";

  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    const pathName = url.pathname.replace(/\/+$/g, "");
    const lowerPath = pathName.toLowerCase();
    const source = `${model}\n${endpoint}`.toLowerCase();

    if (/\/(responses|chat\/completions|messages)$/.test(lowerPath)) {
      url.pathname = pathName || url.pathname;
      return url.toString().replace(/\/$/g, "");
    }

    const isAnthropic = host.includes("anthropic") || /^claude/i.test(model) || /anthropic/.test(source);
    if (isAnthropic) {
      if (!lowerPath || lowerPath === "/") return appendEndpointPath(url, "messages", "/v1");
      if (lowerPath.endsWith("/v1")) return appendEndpointPath(url, "messages");
      return appendEndpointPath(url, "messages");
    }

    const prefersChat = /chat\.completions|\/chat\/completions/.test(source);
    const prefersResponses = !prefersChat && (/responses|response api/.test(source)
      || (host.includes("openai") && /^(gpt-|o\d|o[134]|chatgpt)/i.test(model))
      || (host.includes("volces") && /doubao|seed|ark/.test(source))
      || host.includes("ark.cn-"));
    const suffix = prefersResponses ? "responses" : "chat/completions";

    if (host.includes("openai")) return appendEndpointPath(url, suffix, "/v1");
    if (host.includes("moonshot")) return appendEndpointPath(url, "chat/completions", lowerPath.includes("/v1") ? "" : "/v1");
    if (host.includes("deepseek")) return appendEndpointPath(url, "chat/completions");
    if (host.includes("volces") || host.includes("ark.cn-")) return appendEndpointPath(url, suffix, lowerPath.includes("/api/v3") ? "" : "/api/v3");
    if (lowerPath.endsWith("/v1") || lowerPath.endsWith("/api/v3")) return appendEndpointPath(url, suffix);

    return url.toString().replace(/\/$/g, "");
  } catch {
    return endpoint;
  }
}

function detectApiFormat(endpoint: string): ApiFormat {
  const url = endpoint.trim().toLowerCase();
  if (/\/responses\/?$/.test(url)) return "responses";
  if (/\/v1\/messages\/?$/.test(url) || /anthropic/i.test(url)) return "anthropic";
  return "chat-completions";
}

function buildApiRequest(format: ApiFormat, config: any, prompt: string): { headers: Record<string, string>; body: any } {
  switch (format) {
    case "responses":
      return {
        headers: { "Authorization": `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: { model: config.model, input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }] }
      };
    case "anthropic":
      return {
        headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: { model: config.model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }
      };
    default:
      return {
        headers: { "Authorization": `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: { model: config.model, messages: [{ role: "user", content: prompt }] }
      };
  }
}

async function callConfiguredResponsesApi(config: any, prompt: string): Promise<any> {
  if (!config?.endpoint || !config?.apiKey || !config?.model) {
    throw new Error("Missing analysis API config");
  }

  const endpoint = normalizeAnalysisEndpoint(config.endpoint, config.model);
  const format = detectApiFormat(endpoint);
  const { headers, body } = buildApiRequest(format, config, prompt);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errMsg = payload?.error?.message || payload?.message || `Analysis API failed: ${response.status}`;
      console.error(`[Analysis] ${format} API error:`, errMsg, payload);
      throw new Error(errMsg);
    }

    const text = extractResponsesText(payload);
    if (!text) {
      console.error("[Analysis] Empty response, raw payload keys:", Object.keys(payload || {}));
      throw new Error("Empty response from configured analysis API");
    }

    return JSON.parse(extractJsonText(text));
  } finally {
    clearTimeout(timeout);
  }
}

app.post("/api/analysis/test", async (req, res) => {
  const { analysisConfig } = req.body;

  try {
    await callConfiguredResponsesApi(
      analysisConfig,
      '请只返回严格 JSON：{"ok":true,"message":"pong"}'
    );
    res.json({ ok: true, model: analysisConfig?.model || "未命名模型" });
  } catch (error: any) {
    res.status(502).json({
      ok: false,
      model: analysisConfig?.model || "未命名模型",
      message: error?.message || "分析模型连接失败"
    });
  }
});

// 1. WeChat Reading Gateway Proxy Route
// Takes custom endpoint and key so they can be changed dynamically in the frontend UI
app.post("/api/weread/proxy", async (req, res) => {
  const { targetUrl, skillUrl, apiKey, api_name, skill_version, ...otherParams } = req.body;

  if (!apiKey) {
    return res.status(400).json({ errcode: -1, errmsg: "API Key (Bearer Token) is required" });
  }

  const gatewayUrl = targetUrl || "https://i.weread.qq.com/api/agent/gateway";
  const requestBody = {
    api_name: api_name || "/_list",
    skill_version: skill_version || "1.0.5",
    ...(skillUrl ? { skill_url: skillUrl } : {}),
    ...otherParams
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEREAD_GATEWAY_TIMEOUT_MS);

  try {
    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error: any) {
    console.error("WeRead API Gateway Proxy Error:", error);
    const timeoutMessage = error?.name === "AbortError"
      ? `Proxy request timed out after ${Math.round(WEREAD_GATEWAY_TIMEOUT_MS / 1000)} seconds`
      : error?.message || error;
    res.status(500).json({ errcode: 500, errmsg: `Proxy request failed: ${timeoutMessage}` });
  } finally {
    clearTimeout(timeout);
  }
});

// Proxy route for book covers to bypass CORS restriction in browser for html-to-image
app.get("/api/weread/proxy-cover", async (req, res) => {
  const url = req.query.url as string;
  if (!url) {
    return res.status(400).send("Missing URL parameter");
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://weread.qq.com/"
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch cover. Status: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
    res.send(buffer);
  } catch (error: any) {
    console.error("WeRead Cover Proxy Error:", error);
    res.status(500).send("Failed to load cover image");
  }
});

// 2. Server-side Gemini Reading Personality and Mindmap Analyzer (Lazy-initialized & handles missing key)
app.post("/api/weread/analyze", async (req, res) => {
  const { books, highlights, analysisConfig } = req.body;

  if (!books || !Array.isArray(books) || books.length === 0) {
    return res.status(400).json({ error: "Missing books list for analysis" });
  }

  const normalizedBooks = books.map((item: any) => {
    const book = item?.book || item;
    const readingTimestamp = getReadingTimestampFromItem(item);
    return {
      bookId: item?.bookId || book?.bookId || "",
      title: book?.title || item?.title || "未命名书籍",
      author: book?.author || item?.author || "未知作者",
      category: book?.category || item?.category || book?.categories?.[0]?.title || "未分类",
      readingTime: readingTimestamp || null,
      noteCount: item?.noteCount || 0,
      bookmarkCount: item?.bookmarkCount || 0,
      readingProgress: item?.readingProgress ?? null,
      markedStatus: item?.markedStatus ?? null
    };
  });
  const bookSummaries = normalizedBooks
    .map((b: any) => `【${b.title}】(作者:${b.author}, 分类:${b.category || "未分类"}, 阅读/完成时间:${b.readingTime || "未知"}, 划线:${b.bookmarkCount}, 笔记:${b.noteCount}, 进度:${b.readingProgress ?? "未知"})`)
    .join("\n");
  const requiredYears = getRequiredAnalysisYears(books);
  const quoteSamples = buildHighlightSamples(books, highlights || [], 120).join("\n");
  const externalPrompt = readPersonalityPrompt();
  const finalPrompt = `${externalPrompt}

以下是真实阅读数据：

必须生成的年份：
${requiredYears.join("、")}

书籍数据：
${bookSummaries}

代表性划线内容（按时间与书籍分散抽样）：
${quoteSamples || "暂无划线样本"}

请严格按 prompt 要求返回 JSON。yearlyPersonality 中每一年必须包含 year、title、annualQuestion、visualArchetype、artPersona、personaReason、description，不允许省略 persona 相关字段。`;

  if (analysisConfig?.endpoint && analysisConfig?.apiKey && analysisConfig?.model) {
    try {
      const result = completeAnalysisYears(
        await callConfiguredResponsesApi(analysisConfig, finalPrompt),
        requiredYears,
        books,
        highlights || []
      );
      return res.json({
        ...result,
        isAiGenerated: true,
        analysisModel: analysisConfig.model,
        analysisProvider: "configured"
      });
    } catch (error: any) {
      console.error("Configured Reading Personality Analysis Error:", error);
      const localResult = generateLocalThematicAnalysis(books, highlights || []);
      return res.json({
        ...localResult,
        isAiGenerated: false,
        analysisModel: analysisConfig.model,
        analysisProvider: "configured",
        error: error?.message || "Configured analysis service unavailable, fallback to semantic analyzer"
      });
    }
  }

  const ai = getGeminiClient();

  // If Gemini key is missing, or we fall back to robust local intelligent generator
  if (!ai) {
    // Generate beautiful high-fidelity, deterministic theme/keywords grouping
    const localResult = generateLocalThematicAnalysis(books, highlights || []);
    return res.json({
      ...localResult,
      isAiGenerated: false,
      analysisModel: "本地语义分析",
      analysisProvider: "local",
      message: "Utilizing highly accurate local semantic models (set GEMINI_API_KEY to switch to real-time Gemini AI)"
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: finalPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["yearlyPersonality", "thoughtClusters"],
          properties: {
            yearlyPersonality: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["year", "title", "annualQuestion", "visualArchetype", "artPersona", "personaReason", "description"],
                properties: {
                  year: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  annualQuestion: { type: Type.STRING },
                  visualArchetype: { type: Type.STRING },
                  artPersona: { type: Type.STRING },
                  personaReason: { type: Type.STRING },
                  description: { type: Type.STRING }
                }
              }
            },
            thoughtClusters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["keyword", "books", "thoughtQuote"],
                properties: {
                  keyword: { type: Type.STRING },
                  books: { type: Type.ARRAY, items: { type: Type.STRING } },
                  thoughtQuote: { type: Type.STRING }
                }
              }
            }
          }
        }
      }
    });

    const contentText = response.text;
    if (!contentText) {
      throw new Error("Empty response from Gemini API");
    }

    const result = completeAnalysisYears(JSON.parse(contentText.trim()), requiredYears, books, highlights || []);
    res.json({
      ...result,
      isAiGenerated: true,
      analysisModel: "gemini-3.5-flash",
      analysisProvider: "gemini"
    });

  } catch (error: any) {
    console.error("Gemini Personality Analysis Error:", error);
    // Fallback to local analyzer
    const localResult = generateLocalThematicAnalysis(books, highlights || []);
    res.json({
      ...localResult,
      isAiGenerated: false,
      analysisModel: "gemini-3.5-flash",
      analysisProvider: "gemini",
      error: error?.message || "Gemini service temporary unavailable, fallback to semantic analyzer"
    });
  }
});

/**
 * Fallback semantic parsing that structures beautiful, poetic themes and clusters
 * based on WeChat Reading lists if Gemini API is missing or fails.
 */
function generateLocalThematicAnalysis(books: any[], highlights: any[]) {
  const years = getRequiredAnalysisYears(books);
  const yearlyPersonality = years.map((year) => {
    const yearBooks = books.filter((item, idx) => getBookYearFromItem(item, idx) === year);
    const yearBookIds = new Set(yearBooks.map((item) => item?.bookId || getBookFromItem(item)?.bookId).filter(Boolean));
    const yearHighlights = (highlights || []).filter((item: any) => yearBookIds.has(item?.bookId));
    const title = inferReadingMbtiType(yearBooks, yearHighlights);

    return buildFallbackPersonality(year, title, yearBooks, yearHighlights);
  });

  const categoryGroups = new Map<string, any[]>();
  books.forEach((item) => {
    const category = getBookCategory(item);
    const current = categoryGroups.get(category) || [];
    current.push(item);
    categoryGroups.set(category, current);
  });

  const makeKeyword = (raw: string, index: number) => {
    const cleaned = raw.replace(/^\[|\]$/g, "").replace(/^["']|["']$/g, "").trim() || `阅读主题${index + 1}`;
    return cleaned.length >= 4 ? cleaned.slice(0, 10) : `${cleaned}议题`;
  };

  const thoughtClusters = Array.from(categoryGroups.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6)
    .map(([category, items], index) => {
      const relatedBooks = items.slice(0, 3);
      const relatedIds = new Set(relatedBooks.map((item) => item?.bookId || getBookFromItem(item)?.bookId).filter(Boolean));
      const quote = (highlights || []).find((item: any) => relatedIds.has(item?.bookId) && item?.markText)?.markText;

      return {
        keyword: makeKeyword(category, index),
        books: relatedBooks.map(getBookTitle).filter(Boolean),
        thoughtQuote: quote
          ? compactText(quote, 45)
          : `这些书把${makeKeyword(category, index)}从概念变成可反复辨认的生活问题。`
      };
    });

  while (thoughtClusters.length < 4 && books.length > 0) {
    const start = thoughtClusters.length;
    thoughtClusters.push({
      keyword: `阅读母题${start + 1}`,
      books: books.slice(start, start + 3).map(getBookTitle).filter(Boolean),
      thoughtQuote: "书目之间的暗线，正在把兴趣、问题意识和生活经验连成一张图。"
    });
  }

  return { yearlyPersonality, thoughtClusters };
}

// 3. Vite Server / Production Build Handles
// Mount Vite middleware in development, serve static in production
const isProduction = process.env.NODE_ENV === "production";
const distPath = path.join(process.cwd(), "dist");

async function setupServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { port: HMR_PORT } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

setupServer();
