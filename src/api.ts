/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WeReadOverallStats, WeReadNotebook, WeReadBookNotesResponse } from "./types";
import { getNotebookReadingTimestamp } from "./utils/wereadDates";

const LOCAL_STORAGE_KEY_API_KEY = "weread_api_key";
const LOCAL_STORAGE_KEY_GATEWAY_URL = "weread_gateway_url";
const LOCAL_STORAGE_KEY_SKILL_URL = "weread_skill_url";
const LOCAL_STORAGE_KEY_SKILL_VERSION = "weread_skill_version";
const LOCAL_STORAGE_KEY_SKILL_INSTALL_COMMAND = "weread_skill_install_command";
const LOCAL_STORAGE_KEY_ANALYSIS_API_ENDPOINT = "reading_analysis_api_endpoint";
const LOCAL_STORAGE_KEY_ANALYSIS_API_KEY = "reading_analysis_api_key";
const LOCAL_STORAGE_KEY_ANALYSIS_MODEL = "reading_analysis_model";
const WEREAD_PROXY_TIMEOUT_MS = 180000;
const WEREAD_PROXY_RETRIES = 2;
const NOTEBOOK_FETCH_MIN_COUNT = 100;
const NOTEBOOK_FETCH_MAX_COUNT = 5000;

export const DEFAULT_API_KEY = "";
export const DEFAULT_GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway";
export const DEFAULT_SKILL_VERSION = "1.0.5";
export const DEFAULT_SKILL_INSTALL_COMMAND = "npx skills add Tencent/WeChatReading -g";
export const DEFAULT_ANALYSIS_API_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/responses";
export const DEFAULT_ANALYSIS_MODEL = "doubao-seed-2-0-lite-260428";

export interface AnalysisApiConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

const MBTI_TYPES = new Set([
  "INTJ", "INTP", "ENTJ", "ENTP",
  "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP"
]);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripShellValue(value: string): string {
  return value
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/[),;]+$/g, "")
    .trim();
}

function isConcreteSecret(value?: string): value is string {
  if (!value) return false;
  const cleaned = stripShellValue(value);
  if (!cleaned) return false;
  if (/^\$|process\.env|os\.environ|your[_-]?|example|placeholder|<|>|\{|\}/i.test(cleaned)) return false;
  if (/^[A-Z0-9_]+_API_KEY$/i.test(cleaned)) return false;
  return cleaned.length >= 8;
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return stripShellValue(match[1]);
  }
  return undefined;
}

function appendEndpointPath(url: URL, suffix: string, defaultBasePath = ""): string {
  const cleanPath = url.pathname.replace(/\/+$/g, "");
  const basePath = cleanPath && cleanPath !== "" ? cleanPath : defaultBasePath;
  url.pathname = `${basePath}/${suffix}`.replace(/\/{2,}/g, "/");
  return url.toString().replace(/\/$/g, "");
}

export function normalizeAnalysisEndpoint(rawEndpoint: string, model = "", sourceText = ""): string {
  const endpoint = stripShellValue(rawEndpoint);
  if (!endpoint) return "";

  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    const pathName = url.pathname.replace(/\/+$/g, "");
    const lowerPath = pathName.toLowerCase();
    const source = `${sourceText}\n${model}\n${endpoint}`.toLowerCase();

    if (/\/(responses|chat\/completions|messages)$/.test(lowerPath)) {
      url.pathname = pathName || url.pathname;
      return url.toString().replace(/\/$/g, "");
    }

    const isAnthropic = host.includes("anthropic") || /^claude/i.test(model) || /anthropic|messages\.create|\/v1\/messages/.test(source);
    if (isAnthropic) {
      if (!lowerPath || lowerPath === "/") return appendEndpointPath(url, "messages", "/v1");
      if (lowerPath.endsWith("/v1")) return appendEndpointPath(url, "messages");
      return appendEndpointPath(url, "messages");
    }

    const prefersChat = /chat\.completions|\/chat\/completions/.test(source);
    const prefersResponses = !prefersChat && (/responses\.create|\/responses\b|response api/.test(source)
      || (host.includes("openai") && /^(gpt-|o\d|o[134]|chatgpt)/i.test(model))
      || (host.includes("volces") && /doubao|seed|ark/.test(source))
      || host.includes("ark.cn-"));
    const suffix = prefersResponses ? "responses" : "chat/completions";

    if (host.includes("openai")) {
      return appendEndpointPath(url, suffix, "/v1");
    }

    if (host.includes("moonshot")) {
      return appendEndpointPath(url, "chat/completions", lowerPath.includes("/v1") ? "" : "/v1");
    }

    if (host.includes("deepseek")) {
      return appendEndpointPath(url, "chat/completions");
    }

    if (host.includes("volces") || host.includes("ark.cn-")) {
      return appendEndpointPath(url, suffix, lowerPath.includes("/api/v3") ? "" : "/api/v3");
    }

    if (lowerPath.endsWith("/v1") || lowerPath.endsWith("/api/v3")) {
      return appendEndpointPath(url, suffix);
    }

    return url.toString().replace(/\/$/g, "");
  } catch {
    return endpoint;
  }
}

function inferDefaultAnalysisEndpoint(model = "", sourceText = ""): string | undefined {
  const source = `${sourceText}\n${model}`.toLowerCase();
  if (/claude|anthropic/.test(source)) return "https://api.anthropic.com/v1/messages";
  if (/deepseek/.test(source)) return "https://api.deepseek.com/chat/completions";
  if (/kimi|moonshot/.test(source)) return "https://api.moonshot.cn/v1/chat/completions";
  if (/doubao|volces|ark/.test(source)) return DEFAULT_ANALYSIS_API_ENDPOINT;
  if (/gpt-|openai|responses\.create|chat\.completions/.test(source)) {
    return /chat\.completions/.test(source)
      ? "https://api.openai.com/v1/chat/completions"
      : "https://api.openai.com/v1/responses";
  }
  return undefined;
}

export function getStoredApiKey(): string {
  if (typeof window !== "undefined") {
    return localStorage.getItem(LOCAL_STORAGE_KEY_API_KEY) || DEFAULT_API_KEY;
  }
  return DEFAULT_API_KEY;
}

export function setStoredApiKey(key: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(LOCAL_STORAGE_KEY_API_KEY, key);
  }
}

export function getStoredGatewayUrl(): string {
  if (typeof window !== "undefined") {
    return localStorage.getItem(LOCAL_STORAGE_KEY_GATEWAY_URL) || DEFAULT_GATEWAY_URL;
  }
  return DEFAULT_GATEWAY_URL;
}

export function setStoredGatewayUrl(url: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(LOCAL_STORAGE_KEY_GATEWAY_URL, url);
  }
}

export function getStoredSkillUrl(): string {
  if (typeof window !== "undefined") {
    return localStorage.getItem(LOCAL_STORAGE_KEY_SKILL_URL) || "";
  }
  return "";
}

export function setStoredSkillUrl(url: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(LOCAL_STORAGE_KEY_SKILL_URL, url);
  }
}

export function getStoredSkillVersion(): string {
  if (typeof window !== "undefined") {
    return localStorage.getItem(LOCAL_STORAGE_KEY_SKILL_VERSION) || DEFAULT_SKILL_VERSION;
  }
  return DEFAULT_SKILL_VERSION;
}

export function setStoredSkillVersion(version: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(LOCAL_STORAGE_KEY_SKILL_VERSION, version || DEFAULT_SKILL_VERSION);
  }
}

export function getStoredSkillInstallCommand(): string {
  if (typeof window !== "undefined") {
    return localStorage.getItem(LOCAL_STORAGE_KEY_SKILL_INSTALL_COMMAND) || DEFAULT_SKILL_INSTALL_COMMAND;
  }
  return DEFAULT_SKILL_INSTALL_COMMAND;
}

export function setStoredSkillInstallCommand(command: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(LOCAL_STORAGE_KEY_SKILL_INSTALL_COMMAND, command || DEFAULT_SKILL_INSTALL_COMMAND);
  }
}

export function getStoredAnalysisApiConfig(): AnalysisApiConfig {
  const storedModel = typeof window !== "undefined"
    ? localStorage.getItem(LOCAL_STORAGE_KEY_ANALYSIS_MODEL) || DEFAULT_ANALYSIS_MODEL
    : DEFAULT_ANALYSIS_MODEL;
  const storedEndpoint = typeof window !== "undefined"
    ? localStorage.getItem(LOCAL_STORAGE_KEY_ANALYSIS_API_ENDPOINT) || DEFAULT_ANALYSIS_API_ENDPOINT
    : DEFAULT_ANALYSIS_API_ENDPOINT;

  if (typeof window === "undefined") {
    return {
      endpoint: normalizeAnalysisEndpoint(storedEndpoint, storedModel),
      apiKey: "",
      model: storedModel
    };
  }

  return {
    endpoint: normalizeAnalysisEndpoint(storedEndpoint, storedModel),
    apiKey: localStorage.getItem(LOCAL_STORAGE_KEY_ANALYSIS_API_KEY) || "",
    model: storedModel
  };
}

export function setStoredAnalysisApiConfig(config: AnalysisApiConfig): void {
  if (typeof window !== "undefined") {
    const model = config.model.trim() || DEFAULT_ANALYSIS_MODEL;
    localStorage.setItem(LOCAL_STORAGE_KEY_ANALYSIS_API_ENDPOINT, normalizeAnalysisEndpoint(config.endpoint.trim() || DEFAULT_ANALYSIS_API_ENDPOINT, model));
    localStorage.setItem(LOCAL_STORAGE_KEY_ANALYSIS_API_KEY, config.apiKey.trim());
    localStorage.setItem(LOCAL_STORAGE_KEY_ANALYSIS_MODEL, model);
  }
}

export function parseAnalysisCurl(raw: string): Partial<AnalysisApiConfig> {
  const text = raw.trim();
  if (!text) return {};

  const model = firstMatch(text, [
    /"model"\s*:\s*"([^"]+)"/i,
    /'model'\s*:\s*'([^']+)'/i,
    /\bmodel\s*[:=]\s*["'`]([^"'`]+)["'`]/i
  ]);
  const endpointCandidate = firstMatch(text, [
    /\bcurl\s+(?:-X\s+POST\s+)?["']?(https?:\/\/[^\s'"\\)]+)/i,
    /\b(?:base_url|baseURL|endpoint|url)\s*[:=]\s*["'`](https?:\/\/[^"'`\s]+)["'`]/i,
    /(https?:\/\/[^\s'"\}\\)]+)/i
  ]);
  const keyCandidate = firstMatch(text, [
    /Authorization:\s*Bearer\s+([^'"\s\\]+)/i,
    /x-api-key:\s*([^'"\s\\]+)/i,
    /\bapi[-_]?key\b\s*[:=]\s*["'`]([^"'`]+)["'`]/i,
    /\bapiKey\b\s*[:=]\s*["'`]([^"'`]+)["'`]/i
  ]);
  const endpoint = endpointCandidate
    ? normalizeAnalysisEndpoint(endpointCandidate, model || "", text)
    : inferDefaultAnalysisEndpoint(model || "", text);

  return {
    ...(endpoint ? { endpoint } : {}),
    ...(isConcreteSecret(keyCandidate) ? { apiKey: stripShellValue(keyCandidate) } : {}),
    ...(model ? { model } : {})
  };
}

/**
 * Universal safe query execution going through our Express proxy
 */
async function callWeReadProxy(apiName: string, params: any = {}): Promise<any> {
  const apiKey = getStoredApiKey();
  const gatewayUrl = getStoredGatewayUrl();
  const skillVersion = getStoredSkillVersion();

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= WEREAD_PROXY_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEREAD_PROXY_TIMEOUT_MS);

    try {
      const response = await fetch("/api/weread/proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          targetUrl: gatewayUrl,
          apiKey: apiKey,
          api_name: apiName,
          skill_version: skillVersion,
          ...params
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.errmsg || `Failed: Code ${response.status}`);
      }

      const result = await response.json();
      if (result.errcode && result.errcode !== 0) {
        throw new Error(result.errmsg || `WeRead Error [${result.errcode}]`);
      }

      return result;
    } catch (error: any) {
      lastError = new Error(error?.name === "AbortError"
        ? `微信读书网关请求超过 ${Math.round(WEREAD_PROXY_TIMEOUT_MS / 1000)} 秒未返回`
        : error?.message || String(error));
      if (attempt < WEREAD_PROXY_RETRIES) {
        await wait((attempt + 1) * 800);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("微信读书网关请求失败");
}

function dedupeNotebooks(books: WeReadNotebook[]): WeReadNotebook[] {
  const map = new Map<string, WeReadNotebook>();
  books.forEach((item) => {
    if (!item?.bookId) return;
    map.set(item.bookId, item);
  });
  return Array.from(map.values());
}

/**
 * Fetch Overall Reading Stats
 */
export async function fetchOverallStats(): Promise<WeReadOverallStats> {
  try {
    const data = await callWeReadProxy("/readdata/detail", { mode: "overall" });
    return data;
  } catch (error) {
    console.error("fetchOverallStats failed.", error);
    throw error;
  }
}

/**
 * Fetch Book Notebooks Lists (Books with highlights)
 */
export async function fetchNotebooks(count: number = NOTEBOOK_FETCH_MIN_COUNT): Promise<{ books: WeReadNotebook[], totalNoteCount: number, totalBookCount: number }> {
  try {
    let requestedCount = Math.max(count, NOTEBOOK_FETCH_MIN_COUNT);
    let bestResult: { books: WeReadNotebook[], totalNoteCount: number, totalBookCount: number } | null = null;
    let previousBookCount = -1;

    while (requestedCount <= NOTEBOOK_FETCH_MAX_COUNT) {
      const data = await callWeReadProxy("/user/notebooks", { count: requestedCount });
      const books = dedupeNotebooks(data?.books || []);
      const reportedTotal = Number(data?.totalBookCount || 0);
      const totalBookCount = Math.max(reportedTotal, books.length);
      const currentResult = {
        books,
        totalNoteCount: Number(data?.totalNoteCount || 0),
        totalBookCount
      };

      if (!bestResult || books.length > bestResult.books.length) {
        bestResult = currentResult;
      }

      if (books.length === 0) {
        return { books: [], totalNoteCount: 0, totalBookCount: 0 };
      }

      if ((reportedTotal > 0 && books.length >= reportedTotal) || (reportedTotal <= 0 && books.length < requestedCount)) {
        return currentResult;
      }

      if (books.length === previousBookCount && requestedCount >= Math.max(totalBookCount, NOTEBOOK_FETCH_MIN_COUNT)) {
        break;
      }

      previousBookCount = books.length;
      const nextRequestedCount = Math.min(
        NOTEBOOK_FETCH_MAX_COUNT,
        Math.max(requestedCount * 2, totalBookCount + NOTEBOOK_FETCH_MIN_COUNT)
      );
      if (nextRequestedCount <= requestedCount) break;
      requestedCount = nextRequestedCount;
    }

    return bestResult || { books: [], totalNoteCount: 0, totalBookCount: 0 };
  } catch (error) {
    console.error("fetchNotebooks failed.", error);
    throw error;
  }
}

/**
 * Fetch specific book highlights list
 */
export async function fetchBookNotes(bookId: string): Promise<WeReadBookNotesResponse> {
  try {
    const data = await callWeReadProxy("/book/bookmarklist", { bookId });
    return data;
  } catch (error) {
    console.error(`fetchBookNotes for ${bookId} failed.`, error);
    return {
      synckey: 0,
      updated: [],
      chapters: [],
      book: { bookId, title: "", author: "", cover: "" }
    };
  }
}

/**
 * Fetch AI Synthesized Personality/Mindmap from our fast lazy Gemini proxy
 */
export async function fetchAiAnalysis(books: any[], highlights: any[]): Promise<any> {
  const analysisConfig = getStoredAnalysisApiConfig();
  const response = await fetch("/api/weread/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ books, highlights, analysisConfig })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || result?.message || `Analyze server error: ${response.status}`);
  }
  return result;
}

export async function testAnalysisApiConfig(config: AnalysisApiConfig): Promise<{ ok: boolean; model: string; message?: string }> {
  const response = await fetch("/api/analysis/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analysisConfig: config })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result?.message || `分析模型连接失败：${response.status}`);
  }

  return result;
}

// ==========================================
// Fallbacks for Offline & Error Situations
// ==========================================

function getFallbackStats(): WeReadOverallStats {
  return {
    readDays: 858,
    totalReadTime: 1283609, // ~356.5 hours
    preferCategory: [
      { categoryId: 300000, categoryTitle: "文学", val: 1.0, readingTime: 452207, readingCount: 63 },
      { categoryId: 600000, categoryTitle: "哲学宗教", val: 0.82, readingTime: 150006, readingCount: 12 },
      { categoryId: 100001, categoryTitle: "科学技术", val: 0.65, readingTime: 140250, readingCount: 18 },
      { categoryId: 1100000, categoryTitle: "经济理财", val: 0.44, readingTime: 72700, readingCount: 13 },
      { categoryId: 900000, categoryTitle: "社会文化", val: 0.38, readingTime: 53304, readingCount: 8 }
    ],
    preferCategoryWord: "偏好阅读文学及哲学经典",
    preferTimeWord: "偏好夜间沉静阅读",
    readStat: [
      { stat: "读过", counts: "179本" },
      { stat: "读完", counts: "43本" }
    ]
  };
}

export function getFallbackNotebooks() {
  const books: WeReadNotebook[] = [
    {
      bookId: "43896728",
      book: {
        bookId: "43896728",
        title: "不能承受的生命之轻",
        author: "[法]米兰·昆德拉",
        cover: "https://cdn.weread.qq.com/weread/cover/3/YueWen_43896728/t6_YueWen_43896728.jpg"
      },
      reviewCount: 3,
      noteCount: 8,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000001
    },
    {
      bookId: "3300045871",
      book: {
        bookId: "3300045871",
        title: "被讨厌的勇气",
        author: "岸见一郎",
        cover: "https://img1.read.duokan.com/mfsv2/download/fdsc3/p01O1Z1c7gqP/oPCl4jep17V9gW.jpg?w=1080"
      },
      reviewCount: 12,
      noteCount: 15,
      bookmarkCount: 2,
      markedStatus: 1,
      sort: 1720000002
    },
    {
      bookId: "19830571",
      book: {
        bookId: "19830571",
        title: "原子习惯",
        author: "詹姆斯·克利尔",
        cover: "https://cdn.weread.qq.com/weread/cover/54/YueWen_22396454/t6_YueWen_22396454.jpg"
      },
      reviewCount: 5,
      noteCount: 18,
      bookmarkCount: 0,
      markedStatus: 1,
      sort: 1720000003
    },
    {
      bookId: "22830172",
      book: {
        bookId: "22830172",
        title: "月亮与六便士",
        author: "萨默塞特·毛姆",
        cover: "https://cdn.weread.qq.com/weread/cover/68/YueWen_823331/t6_YueWen_823331.jpg"
      },
      reviewCount: 4,
      noteCount: 10,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000004
    },
    {
      bookId: "11928373",
      book: {
        bookId: "11928373",
        title: "活着",
        author: "余华",
        cover: "https://cdn.weread.qq.com/weread/cover/89/YueWen_825838/t6_YueWen_825838.jpg"
      },
      reviewCount: 9,
      noteCount: 14,
      bookmarkCount: 3,
      markedStatus: 1,
      sort: 1720000005
    },
    {
      bookId: "25830201",
      book: {
        bookId: "25830201",
        title: "弱者的武器",
        author: "詹姆斯·C·斯科特",
        cover: "https://cdn.weread.qq.com/weread/cover/57/YueWen_23405757/t6_YueWen_23405757.jpg"
      },
      reviewCount: 2,
      noteCount: 6,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000006
    },
    {
      bookId: "26830202",
      book: {
        bookId: "26830202",
        title: "我们为什么不...",
        author: "垣谷美雨",
        cover: "https://cdn.weread.qq.com/weread/cover/12/YueWen_23393212/t6_YueWen_23393212.jpg"
      },
      reviewCount: 1,
      noteCount: 5,
      bookmarkCount: 0,
      markedStatus: 1,
      sort: 1720000007
    },
    {
      bookId: "27830203",
      book: {
        bookId: "27830203",
        title: "始于极限：女孩们在往复书简里谈论什么",
        author: "上野千鹤子 / 铃木凉美",
        cover: "https://cdn.weread.qq.com/weread/cover/4/YueWen_33501004/t6_YueWen_33501004.jpg"
      },
      reviewCount: 8,
      noteCount: 12,
      bookmarkCount: 2,
      markedStatus: 1,
      sort: 1720000008
    },
    {
      bookId: "28830204",
      book: {
        bookId: "28830204",
        title: "油炸绿番茄",
        author: "[美] 房尼·弗拉格",
        cover: "https://cdn.weread.qq.com/weread/cover/33/YueWen_33515833/t6_YueWen_33515833.jpg"
      },
      reviewCount: 4,
      noteCount: 7,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000009
    },
    {
      bookId: "29830205",
      book: {
        bookId: "29830205",
        title: "庄子",
        author: "孙通海 译注",
        cover: "https://cdn.weread.qq.com/weread/cover/15/YueWen_31615/t6_YueWen_31615.jpg"
      },
      reviewCount: 3,
      noteCount: 9,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000010
    },
    {
      bookId: "30830206",
      book: {
        bookId: "30830206",
        title: "追忆似水年华",
        author: "[法] 马塞尔·普鲁斯特",
        cover: "https://cdn.weread.qq.com/weread/cover/86/YueWen_846786/t6_YueWen_846786.jpg"
      },
      reviewCount: 2,
      noteCount: 6,
      bookmarkCount: 0,
      markedStatus: 1,
      sort: 1720000011
    },
    {
      bookId: "31830207",
      book: {
        bookId: "31830207",
        title: "今日简史",
        author: "[以] 尤瓦尔·赫拉利",
        cover: "https://cdn.weread.qq.com/weread/cover/78/YueWen_33452478/t6_YueWen_33452478.jpg"
      },
      reviewCount: 6,
      noteCount: 10,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000012
    },
    {
      bookId: "32830208",
      book: {
        bookId: "32830208",
        title: "开场：女性学者访谈",
        author: "新京报书评周刊",
        cover: "https://cdn.weread.qq.com/weread/cover/1/YueWen_33560201/t6_YueWen_33560201.jpg"
      },
      reviewCount: 5,
      noteCount: 8,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000013
    },
    {
      bookId: "33830209",
      book: {
        bookId: "33830209",
        title: "暮色将尽",
        author: "[英] 戴安娜·阿西尔",
        cover: "https://cdn.weread.qq.com/weread/cover/58/YueWen_33590258/t6_YueWen_33590258.jpg"
      },
      reviewCount: 7,
      noteCount: 11,
      bookmarkCount: 2,
      markedStatus: 1,
      sort: 1720000014
    },
    {
      bookId: "34830210",
      book: {
        bookId: "34830210",
        title: "小王子",
        author: "[法] 圣埃克苏佩里",
        cover: "https://cdn.weread.qq.com/weread/cover/42/YueWen_833242/t6_YueWen_833242.jpg"
      },
      reviewCount: 10,
      noteCount: 14,
      bookmarkCount: 3,
      markedStatus: 1,
      sort: 1720000015
    },
    {
      bookId: "35830211",
      book: {
        bookId: "35830211",
        title: "昨日的世界",
        author: "[奥] 斯蒂芬·茨威格",
        cover: "https://cdn.weread.qq.com/weread/cover/56/YueWen_849756/t6_YueWen_849756.jpg"
      },
      reviewCount: 6,
      noteCount: 9,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000016
    },
    {
      bookId: "36830212",
      book: {
        bookId: "36830212",
        title: "每一句话语都...",
        author: "[韩] 韩江",
        cover: "https://cdn.weread.qq.com/weread/cover/11/YueWen_33610211/t6_YueWen_33610211.jpg"
      },
      reviewCount: 4,
      noteCount: 7,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000017
    },
    {
      bookId: "37830213",
      book: {
        bookId: "37830213",
        title: "世界哲学史",
        author: "汉斯·约阿希姆·施杜里希",
        cover: "https://cdn.weread.qq.com/weread/cover/88/YueWen_33580488/t6_YueWen_33580488.jpg"
      },
      reviewCount: 5,
      noteCount: 15,
      bookmarkCount: 2,
      markedStatus: 1,
      sort: 1720000018
    },
    {
      bookId: "38830214",
      book: {
        bookId: "38830214",
        title: "谈修养",
        author: "朱光潜",
        cover: "https://cdn.weread.qq.com/weread/cover/18/YueWen_836118/t6_YueWen_836118.jpg"
      },
      reviewCount: 3,
      noteCount: 6,
      bookmarkCount: 0,
      markedStatus: 1,
      sort: 1720000019
    },
    {
      bookId: "39830215",
      book: {
        bookId: "39830215",
        title: "上升的一切必将汇合",
        author: "[美] 弗兰纳里·奥康纳",
        cover: "https://cdn.weread.qq.com/weread/cover/25/YueWen_33560225/t6_YueWen_33560225.jpg"
      },
      reviewCount: 2,
      noteCount: 5,
      bookmarkCount: 0,
      markedStatus: 1,
      sort: 1720000020
    },
    {
      bookId: "40830216",
      book: {
        bookId: "40830216",
        title: "如何找到想做的事",
        author: "[日] 八木仁平",
        cover: "https://cdn.weread.qq.com/weread/cover/16/YueWen_33580216/t6_YueWen_33580216.jpg"
      },
      reviewCount: 4,
      noteCount: 8,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000021
    },
    {
      bookId: "41830217",
      book: {
        bookId: "41830217",
        title: "故事：材质、结构、风格",
        author: "[美] 罗伯特·麦基",
        cover: "https://cdn.weread.qq.com/weread/cover/17/YueWen_835817/t6_YueWen_835817.jpg"
      },
      reviewCount: 5,
      noteCount: 11,
      bookmarkCount: 2,
      markedStatus: 1,
      sort: 1720000022
    },
    {
      bookId: "42830218",
      book: {
        bookId: "42830218",
        title: "明亮的夜晚",
        author: "[韩] 崔恩荣",
        cover: "https://cdn.weread.qq.com/weread/cover/12/YueWen_33590212/t6_YueWen_33590212.jpg"
      },
      reviewCount: 3,
      noteCount: 7,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000023
    },
    {
      bookId: "43830219",
      book: {
        bookId: "43830219",
        title: "中国哲学十五讲",
        author: "陆建华",
        cover: "https://cdn.weread.qq.com/weread/cover/19/YueWen_33510219/t6_YueWen_33510219.jpg"
      },
      reviewCount: 4,
      noteCount: 9,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000024
    },
    {
      bookId: "44830220",
      book: {
        bookId: "44830220",
        title: "随机漫步的傻瓜",
        author: "[美] 纳西姆·塔勒布",
        cover: "https://cdn.weread.qq.com/weread/cover/20/YueWen_22390220/t6_YueWen_22390220.jpg"
      },
      reviewCount: 6,
      noteCount: 12,
      bookmarkCount: 2,
      markedStatus: 1,
      sort: 1720000025
    },
    {
      bookId: "45830221",
      book: {
        bookId: "45830221",
        title: "可能性之艺术",
        author: "刘瑜",
        cover: "https://cdn.weread.qq.com/weread/cover/21/YueWen_33520221/t6_YueWen_33520221.jpg"
      },
      reviewCount: 5,
      noteCount: 10,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000026
    },
    {
      bookId: "46830222",
      book: {
        bookId: "46830222",
        title: "大问题：简明哲学导论",
        author: "[美] 罗伯特·所罗门",
        cover: "https://cdn.weread.qq.com/weread/cover/22/YueWen_22350222/t6_YueWen_22350222.jpg"
      },
      reviewCount: 8,
      noteCount: 14,
      bookmarkCount: 3,
      markedStatus: 1,
      sort: 1720000027
    },
    {
      bookId: "47830223",
      book: {
        bookId: "47830223",
        title: "我的阿勒泰",
        author: "李娟",
        cover: "https://cdn.weread.qq.com/weread/cover/23/YueWen_33490223/t6_YueWen_33490223.jpg"
      },
      reviewCount: 9,
      noteCount: 11,
      bookmarkCount: 2,
      markedStatus: 1,
      sort: 1720000028
    },
    {
      bookId: "48830224",
      book: {
        bookId: "48830224",
        title: "自控力",
        author: "[美] 凯利·麦格尼格尔",
        cover: "https://cdn.weread.qq.com/weread/cover/24/YueWen_22340224/t6_YueWen_22340224.jpg"
      },
      reviewCount: 7,
      noteCount: 9,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000029
    },
    {
      bookId: "49830225",
      book: {
        bookId: "49830225",
        title: "置身事内：中国政府与经济发展",
        author: "兰小欢",
        cover: "https://cdn.weread.qq.com/weread/cover/25/YueWen_33480225/t6_YueWen_33480225.jpg"
      },
      reviewCount: 12,
      noteCount: 16,
      bookmarkCount: 4,
      markedStatus: 1,
      sort: 1720000030
    },
    {
      bookId: "50830226",
      book: {
        bookId: "50830226",
        title: "深度工作",
        author: "[美] 卡尔·纽波特",
        cover: "https://cdn.weread.qq.com/weread/cover/26/YueWen_22370226/t6_YueWen_22370226.jpg"
      },
      reviewCount: 5,
      noteCount: 7,
      bookmarkCount: 1,
      markedStatus: 1,
      sort: 1720000031
    }
  ];
  return {
    books,
    totalBookCount: books.length,
    totalNoteCount: books.reduce((sum, b) => sum + b.noteCount, 0)
  };
}

export function getFallbackBookNotes(bookId: string): WeReadBookNotesResponse {
  const customQuotes: Record<string, string[]> = {
    "43896728": [
      "他爱母亲，从童年一直到将她送入墓地的那一刻，并且仍在回忆里爱着她。",
      "最沉重的负担压迫着我们，让我们屈服于它，把我们压到地上。但最沉重的负担同时也是一种生活最为充实的象征。",
      "如果生命的初次排练就已经成了生命本身，那么生命值多少呢？"
    ],
    "3300045871": [
      "请不要忘记：决定我们自己的，不是过去的经历，而是我们自己赋予经历的意义。",
      "所谓的自由，就是被别人讨厌。当你不再寻求外界的认可，你才真正属于你自己。",
      "课题分离：不要去干涉别人的课题，也不要让别人干涉你的课题。"
    ],
    "19830571": [
      "人们很容易高估某个决定性时刻的重要性，也很容易低估每天进行微小改进的价值。",
      "你得到的不是你想要的结果，而是你每日坚持的习惯和系统的延伸物。",
      "自律者的日常绝非靠超人的意志力，而是他们建立了顺畅无阻的习惯系统。"
    ],
    "22830172": [
      "满地都是六便士，他却抬头看见了那一轮皎洁优雅的月亮。"
    ],
    "11928373": [
      "人是为了活着本身而活着的，而不是为了活着之外的任何事物而活着。"
    ],
    "25830201": [
      "日常形式的农民反抗——偷懒、装糊涂、起哄、偷窃、背后说坏话——是弱者生存的武器。"
    ],
    "27830203": [
      "女性主义不是关于强者的，而是关于弱者也能够受到尊重的思想。",
      "自我决定与自我责任是完全不同性质的两个词。"
    ],
    "28830204": [
      "我们要记住，善良和真诚在这个世界上绝不会失去它们的价值，无论风暴如何剧烈。"
    ],
    "29830205": [
      "独与天地精神往来，而不敖倪于万物。"
    ],
    "30830206": [
      "唯一真实的乐园是我们已经失去的乐园。",
      "当岁月流逝，所有的东西都消失时，唯有气味和味道还保持了长久。"
    ],
    "31830207": [
      "在一个被无关信息淹没的世界里，清晰地表达和洞察真相就是一种力量。"
    ],
    "32830208": [
      "学术不仅是真理的探求，更是在现实的泥泞中为弱者和边缘人寻找立足的理性之地。"
    ],
    "33830209": [
      "到了老年，生命的河流渐渐干涸，但正因如此，我们能够以前所未有的冷静和豁然，看待曾经的波涛汹涌。"
    ],
    "34830210": [
      "你为你的玫瑰花付出的时间，让你的玫瑰花变得如此重要。",
      "只有用心灵才能看得清。实质性的东西，用眼睛是看不见的。"
    ],
    "35830211": [
      "我在这个世界上所度过的，是我一生中最美好的年华，那时的时代虽然满是动荡，但充满了理想与希望。"
    ],
    "45830221": [
      "政治学是在一切可能性中寻找到不那么坏的选项的艺术，而非完美的终点。"
    ],
    "47830223": [
      "李娟笔下的阿勒泰安详而自由，生命像野草一样野蛮生长，又像云朵一样自得其乐。"
    ],
    "49830225": [
      "中国经济发展的奇迹，深深根植于地方政府的多重激励体制，以及官商配合的复杂机制中。"
    ]
  };

  const quotes = customQuotes[bookId] || ["书籍是治愈愚昧的良药，划线让思绪留下痕迹。"];
  const bookMeta = getFallbackNotebooks().books.find(b => b.bookId === bookId);
  
  return {
    synckey: 1,
    book: bookMeta?.book || { bookId, title: "未知书籍", author: "佚名", cover: "" },
    chapters: [
      { chapterUid: 101, chapterIdx: 1, title: "第一章 思想的原野" },
      { chapterUid: 102, chapterIdx: 2, title: "第二章 命运的低语" }
    ],
    updated: quotes.map((q, idx) => ({
      bookmarkId: `${bookId}_q_${idx}`,
      bookId,
      chapterUid: 101,
      markText: q,
      createTime: 1720000000 + idx * 86400,
      type: 1,
      range: "10-20"
    }))
  };
}

function getFallbackAiAnalysis(books: any[], highlights: any[]) {
  // If no books are provided or they match offline defaults, keep the high-fidelity offline presets
  if (!books || books.length === 0) {
    return {
      yearlyPersonality: [
        { year: 2023, title: "INFJ", description: "INFJ 来自文学与心理议题的交叉：你反复辨认理想、他人期待与个人课题之间的界线，阅读像是在把人生主权慢慢收回手中。" },
        { year: 2024, title: "INTJ", description: "INTJ 来自系统、习惯与现实运行逻辑的阅读重心：你更关心秩序如何塑造人，也开始用结构化方法处理变化。" },
        { year: 2025, title: "INFP", description: "INFP 来自文学、命运与自我解释的密集阅读：你在生命轻重之间停留，保存敏感、悲悯和对复杂处境的理解。" },
        { year: 2026, title: "ENFP", description: "ENFP 来自整合与外展的阅读轨迹：文学的感受力、哲学的追问和现实的清醒被放到同一张桌上，底色更松弛。" }
      ],
      thoughtClusters: [
        {
          keyword: "课题分离与被讨厌",
          books: ["被讨厌的勇气"],
          thoughtQuote: "所谓的自由，就是被别人讨厌。课题分离是迈向心智自由的第一步。"
        },
        {
          keyword: "存在之重与悲悯",
          books: ["不能承受的生命之轻", "活着"],
          thoughtQuote: "生命最沉重的负担既是压迫，也是精神最富足的体现。我们在承重中见证活着的本真。"
        },
        {
          keyword: "满地六便士与圆月",
          books: ["月亮与六便士"],
          thoughtQuote: "大众沉溺在汲取生存的六便士中，唯独真正的行旅者，肯抬头拥抱皎洁幽邃的灵性之月。"
        },
        {
          keyword: "行为物理与习惯微雕",
          books: ["原子习惯"],
          thoughtQuote: "习惯是自我的终身雕刻者。每天微小的变化，构建起无坚不摧的心灵秩序系统。"
        }
      ]
    };
  }

  // 1. Dynamic Year Parser
  const getBookYear = (nb: WeReadNotebook): number => {
    const timestamp = getNotebookReadingTimestamp(nb);
    if (timestamp) return new Date(timestamp * 1000).getFullYear();
    return new Date().getFullYear();
  };

  // Group books by year
  const booksByYear: Record<number, any[]> = {};
  books.forEach((nb) => {
    const y = getBookYear(nb);
    if (!booksByYear[y]) booksByYear[y] = [];
    booksByYear[y].push(nb);
  });

  const parsedYears = Object.keys(booksByYear).map(Number).sort((a, b) => b - a);
  // Ensure we cover standard years if needed
  const yearsToCover = parsedYears.length > 0 ? parsedYears : [2026, 2025, 2024, 2023];

  const yearlyPersonality = yearsToCover.map((yr, index) => {
    const yrBooks = booksByYear[yr] || [];
    
    // Choose titles for titles list
    const firstBStr = yrBooks[0] ? `《${yrBooks[0].book.title}》` : "";
    const secondBStr = yrBooks[1] ? `、《${yrBooks[1].book.title}》` : "";
    
    // Theme phrases for titles
    const baseThemes = [
      "INFJ",
      "INTJ",
      "INFP",
      "ENTP",
      "ENFP",
      "ISTJ"
    ];
    const title = baseThemes[index % baseThemes.length];

    // Find any quote in this year
    const yrHighlights = highlights.filter(h => {
      return yrBooks.some(yb => yb.bookId === h.bookId);
    });
    const repQuote = yrHighlights[0]?.markText || "书籍是打破冰封心灵的一把利斧，让心事在此安顿。";
    const shortQuote = repQuote.length > 45 ? repQuote.substring(0, 42) + "..." : repQuote;

    let description = "";
    if (yrBooks.length > 0) {
      description = `这一年你集中吸收了 ${firstBStr}${secondBStr} 等思想源流，并不断回到「${shortQuote}」这一类问题上。阅读像是在为现实生活重新校准坐标：既辨认外部世界的结构，也整理自己的边界、欲望与行动方式。`;
    } else {
      description = `这一年更像一次缓慢的精神预热：你借由通识经典、文学经验与现实议题搭建新的认知地图。表面是在扩充书目，深处其实是在训练自己如何理解复杂世界，并保留独立判断。`;
    }

    return {
      year: yr,
      title,
      description
    };
  });

  // 2. Dynamic Thought Clusters (For 2x2 Bento Relationship Mindmap)
  const thoughtClusters = [];
  const clusterCount = 4;

  for (let clIdx = 0; clIdx < clusterCount; clIdx++) {
    const mainBook = books[clIdx % books.length];
    const secondBook = books[(clIdx + 1) % books.length];

    const mainTitle = mainBook ? mainBook.book.title : "经典著作";
    const secondTitle = secondBook && secondBook.bookId !== mainBook.bookId ? secondBook.book.title : "";

    const clBooks = secondTitle ? [mainTitle, secondTitle] : [mainTitle];

    // Grabbing highlights matching these books
    const currentHighlights = highlights.filter(h => h.bookId === mainBook?.bookId || h.bookId === secondBook?.bookId);
    const primaryQuote = currentHighlights[clIdx % (currentHighlights.length || 1)]?.markText || 
                         (mainBook ? `阅读《${mainTitle}》获得的独特精神启示，深化了该主题的心智感悟。` : "思想在大地深处联结，编织出理性的认知经纬网。");

    // Formulate a beautiful theme/keyword
    let keyword = "";
    if (secondTitle) {
      keyword = `《${mainTitle}》与《${secondTitle}》的共鸣`;
    } else {
      keyword = `关乎《${mainTitle}》的思想对焦`;
    }

    thoughtClusters.push({
      keyword,
      books: clBooks,
      thoughtQuote: primaryQuote.length > 80 ? primaryQuote.substring(0, 77) + "..." : primaryQuote
    });
  }

  return {
    yearlyPersonality,
    thoughtClusters,
    isAiGenerated: false
  };
}
