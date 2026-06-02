const ANALYSIS_TIMEOUT_MS = 55_000;
const MIN_VALID_READING_YEAR = 2000;
const FUTURE_READING_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const MBTI_TYPES = new Set([
  "INTJ", "INTP", "ENTJ", "ENTP",
  "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP"
]);

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
}

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

export function normalizeAnalysisEndpoint(rawEndpoint: string, model = ""): string {
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

function detectApiFormat(endpoint: string): "responses" | "anthropic" | "chat-completions" {
  const url = endpoint.trim().toLowerCase();
  if (/\/responses\/?$/.test(url)) return "responses";
  if (/\/v1\/messages\/?$/.test(url) || /anthropic/i.test(url)) return "anthropic";
  return "chat-completions";
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

function extractJsonText(text: string): string {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return cleaned.slice(firstBrace, lastBrace + 1);
  return cleaned;
}

function buildApiRequest(format: ReturnType<typeof detectApiFormat>, config: any, prompt: string) {
  if (format === "responses") {
    return {
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: { model: config.model, input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }] }
    };
  }

  if (format === "anthropic") {
    return {
      headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: { model: config.model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }
    };
  }

  return {
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: { model: config.model, messages: [{ role: "user", content: prompt }] }
  };
}

export async function callConfiguredAnalysisApi(config: any, prompt: string): Promise<any> {
  if (!config?.endpoint || !config?.apiKey || !config?.model) {
    throw new Error("缺少分析模型配置");
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
      throw new Error(payload?.error?.message || payload?.message || `分析模型请求失败：${response.status}`);
    }
    const text = extractResponsesText(payload);
    if (!text) throw new Error("分析模型返回为空");
    return JSON.parse(extractJsonText(text));
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`分析模型请求超过 ${Math.round(ANALYSIS_TIMEOUT_MS / 1000)} 秒未返回`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

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
  const candidates = [book?.readUpdateTime, book?.finishReading, item?.readUpdateTime, item?.finishReading, item?.sort];
  const timestamp = candidates.find((value) => isValidReadingTimestamp(value));
  return timestamp ? Number(timestamp) : undefined;
}

function getEstimatedPastDate(idx: number, now = new Date()): Date {
  const day = Math.min(now.getDate(), 28);
  return new Date(now.getFullYear(), now.getMonth() - idx, day);
}

function getBookYearFromItem(item: any, idx = 0): number {
  const timestamp = getReadingTimestampFromItem(item);
  return timestamp ? new Date(timestamp * 1000).getFullYear() : getEstimatedPastDate(idx).getFullYear();
}

export function getRequiredAnalysisYears(books: any[]): number[] {
  return Array.from(new Set((books || []).map((item, idx) => getBookYearFromItem(item, idx)))).sort((a, b) => b - a);
}

function getBookFromItem(item: any): any {
  return item?.book || item || {};
}

function getBookTitle(item: any): string {
  return getBookFromItem(item)?.title || item?.title || "未命名书籍";
}

function getBookCategory(item: any): string {
  const book = getBookFromItem(item);
  return String(book?.category || item?.category || book?.categories?.[0]?.title || "未分类");
}

function compactText(text: string, maxLength: number): string {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function buildHighlightSamples(books: any[], highlights: any[], limit = 80): string[] {
  const bookById = new Map<string, any>();
  books.forEach((item) => {
    if (item?.bookId) bookById.set(item.bookId, item);
  });

  return (highlights || [])
    .filter((item: any) => item?.markText && String(item.markText).trim().length >= 4)
    .sort((a: any, b: any) => Number(b?.createTime || 0) - Number(a?.createTime || 0))
    .slice(0, limit)
    .map((item: any) => {
      const book = bookById.get(item?.bookId);
      const title = item?.bookName || getBookTitle(book) || "";
      const createTime = item?.createTime ? new Date(item.createTime * 1000).toISOString().slice(0, 10) : "未知时间";
      return `《${title}》(${createTime}) "${compactText(item.markText, 140)}"`;
    });
}

export function buildReadingAnalysisPrompt(books: any[], highlights: any[]): string {
  const normalizedBooks = (books || []).slice(0, 220).map((item: any, index: number) => {
    const book = item?.book || item;
    return {
      title: book?.title || item?.title || "未命名书籍",
      author: book?.author || item?.author || "未知作者",
      category: book?.category || item?.category || book?.categories?.[0]?.title || "未分类",
      year: getBookYearFromItem(item, index),
      noteCount: item?.noteCount || 0,
      bookmarkCount: item?.bookmarkCount || 0
    };
  });
  const requiredYears = getRequiredAnalysisYears(books);
  const bookSummaries = normalizedBooks
    .map((b) => `【${b.title}】作者:${b.author}; 分类:${b.category}; 年份:${b.year}; 划线:${b.bookmarkCount}; 笔记:${b.noteCount}`)
    .join("\n");
  const quoteSamples = buildHighlightSamples(books, highlights, 80).join("\n");

  return `你是一位阅读 MBTI 分析师和思想图谱编辑。请根据用户每年的书籍、分类、阅读时间、划线与笔记，推断标准四字母 MBTI 类型，并提炼思想聚类。

只返回严格 JSON，不要 Markdown，不要解释。JSON 结构必须是：
{
  "yearlyPersonality": [
    { "year": 2026, "title": "INFJ", "annualQuestion": "一句年度问题", "description": "一段中文解释" }
  ],
  "thoughtClusters": [
    { "keyword": "主题词", "books": ["书名1", "书名2"], "thoughtQuote": "一句洞察或划线摘录" }
  ]
}

要求：
1. yearlyPersonality 必须覆盖这些年份：${requiredYears.join("、") || "无"}。
2. title 必须是标准 MBTI：INTJ、INTP、ENTJ、ENTP、INFJ、INFP、ENFJ、ENFP、ISTJ、ISFJ、ESTJ、ESFJ、ISTP、ISFP、ESTP、ESFP。
3. thoughtClusters 返回 4 到 6 个。
4. 所有文案使用中文，具体、有判断，不要泛泛而谈。

书籍数据：
${bookSummaries || "暂无书籍"}

代表性划线：
${quoteSamples || "暂无划线样本"}`;
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

  const result = `${socialScore > inwardScore + 1 ? "E" : "I"}${abstractScore >= practicalScore ? "N" : "S"}${logicScore > feelingScore ? "T" : "F"}${orderScore >= openScore ? "J" : "P"}`;
  return MBTI_TYPES.has(result) ? result : "INFJ";
}

function fallbackPersonality(year: number, books: any[], highlights: any[]) {
  const type = inferReadingMbtiType(books, highlights);
  const titles = books.map(getBookTitle).filter(Boolean).slice(0, 3);
  const categories = Array.from(new Set(books.map(getBookCategory))).slice(0, 3).join("、") || "未分类";
  return {
    year,
    title: type,
    annualQuestion: "这些阅读如何重新组织你的判断",
    description: `${year} 年的阅读集中在${categories}，${titles.length ? `以《${titles.join("》《")}》为代表，` : ""}呈现出 ${type} 式的理解路径：先建立意义框架，再回到具体经验中校准边界。`
  };
}

export function completeAnalysisYears(analysis: any, requiredYears: number[], books: any[], highlights: any[]) {
  const byYear = new Map<number, any>();
  (analysis?.yearlyPersonality || []).forEach((item: any) => {
    const year = Number(item?.year);
    if (!Number.isFinite(year)) return;
    const title = String(item?.title || "").toUpperCase().match(/\b[EI][NS][TF][JP]\b/)?.[0] || "";
    byYear.set(year, {
      year,
      title: MBTI_TYPES.has(title) ? title : "INFJ",
      annualQuestion: String(item?.annualQuestion || "这一年的核心问题是什么"),
      description: String(item?.description || "这一年的阅读正在形成新的理解结构。")
    });
  });

  const yearlyPersonality = requiredYears.map((year) => {
    if (byYear.has(year)) return byYear.get(year);
    const yearBooks = books.filter((item, idx) => getBookYearFromItem(item, idx) === year);
    const ids = new Set(yearBooks.map((item) => item?.bookId || getBookFromItem(item)?.bookId).filter(Boolean));
    return fallbackPersonality(year, yearBooks, (highlights || []).filter((item: any) => ids.has(item?.bookId)));
  });

  const thoughtClusters = Array.isArray(analysis?.thoughtClusters)
    ? analysis.thoughtClusters.slice(0, 6).map((item: any, index: number) => ({
      keyword: String(item?.keyword || `阅读主题${index + 1}`).slice(0, 12),
      books: Array.isArray(item?.books) ? item.books.map(String).slice(0, 4) : [],
      thoughtQuote: String(item?.thoughtQuote || "这些书之间出现了可辨认的思想暗线。")
    }))
    : [];

  while (thoughtClusters.length < 4 && books.length > 0) {
    const index = thoughtClusters.length;
    thoughtClusters.push({
      keyword: `阅读母题${index + 1}`,
      books: books.slice(index, index + 3).map(getBookTitle).filter(Boolean),
      thoughtQuote: "书目之间的暗线，正在把兴趣、问题意识和生活经验连成一张图。"
    });
  }

  return { yearlyPersonality, thoughtClusters };
}
