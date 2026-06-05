/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { Compass, BookOpen, Quote, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, FileText, FolderSync, PlusCircle, Trash2, BrainCircuit } from "lucide-react";
import { PreferCategory, WeReadNotebook, WeReadHighlight, WeReadOverallStats } from "./types";
import { fetchNotebooks, fetchOverallStats, fetchBookNotes, fetchAiAnalysis, getStoredAnalysisApiConfig, getStoredApiKey, AnalysisApiConfig } from "./api";
import InfiniteCanvas from "./components/InfiniteCanvas";
import SettingsPanel from "./components/SettingsPanel";
import AnalysisSettingsPanel from "./components/AnalysisSettingsPanel";
import GrowthMap from "./components/GrowthMap";
import CognitiveLandscape from "./components/CognitiveLandscape";
import RelationshipMap from "./components/RelationshipMap";
import CardSwiper from "./components/CardSwiper";
import ObsidianImporter from "./components/ObsidianImporter";
import ReadingTrends from "./components/ReadingTrends";
import { getNotebookTimeInfo } from "./utils/wereadDates";

type DataMode = "weread" | "obsidian";
type HighlightWithBook = WeReadHighlight & { bookName: string; bookAuthor: string; bookCover: string };

interface CachedModeData {
  notebooks: WeReadNotebook[];
  stats: WeReadOverallStats | null;
  highlights: HighlightWithBook[];
  yearlyPersonality: Array<{
    year: number;
    title: string;
    annualQuestion?: string;
    visualArchetype?: string;
    artPersona?: string;
    personaReason?: string;
    description: string;
  }>;
  thoughtClusters: Array<{ keyword: string; books: string[]; thoughtQuote: string }>;
  isAiGenerated: boolean;
  analysisConnected: boolean;
  analysisModel: string;
}

interface StoredAnalysis {
  yearlyPersonality: CachedModeData["yearlyPersonality"];
  thoughtClusters: Array<{ keyword: string; books: string[]; thoughtQuote: string }>;
  isAiGenerated: boolean;
  analysisConnected: boolean;
  analysisModel: string;
  sourceSignature?: string;
}

const ANALYSIS_CACHE_PREFIX = "reading_analysis_result_v1";
const LAST_ANALYSIS_KEY_PREFIX = "reading_analysis_last_v1";
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

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function buildAnalysisCacheKey(mode: DataMode, books: WeReadNotebook[], highlights: HighlightWithBook[]): string {
  const config = getStoredAnalysisApiConfig();
  const modelPart = `${config.endpoint}|${config.model}`;
  return `${ANALYSIS_CACHE_PREFIX}:${mode}:${hashString(`${modelPart}::${buildAnalysisSourceSignature(books, highlights)}`)}`;
}

function buildAnalysisSourceSignature(books: WeReadNotebook[], highlights: HighlightWithBook[]): string {
  const bookPart = books.map((nb) => [
    nb.bookId,
    nb.book?.title,
    nb.book?.author,
    nb.book?.readUpdateTime,
    nb.book?.finishReading,
    nb.noteCount
  ].join(":")).join("|");
  const highlightPart = highlights.map((h) => [
    h.bookId,
    h.bookmarkId,
    h.createTime,
    h.markText?.slice(0, 80)
  ].join(":")).join("|");
  return hashString(`${bookPart}::${highlightPart}`);
}

function getNotebookYear(notebook: WeReadNotebook, index = 0): number {
  return getNotebookTimeInfo(notebook, index).year;
}

function inferAnnualQuestion(books: WeReadNotebook[], highlights: HighlightWithBook[]): string {
  const text = [
    ...books.map((nb) => `${nb.book?.title || ""} ${nb.book?.category || ""}`),
    ...highlights.map((h) => h.markText || "")
  ].join(" ");
  if (/自由|边界|关系/.test(text)) return "自由与边界如何共存";
  if (/秩序|规则|习惯|系统/.test(text)) return "秩序如何从混乱中生成";
  if (/真实|真相|证据|怀疑/.test(text)) return "经验能否抵达真相";
  if (/权力|治理|商业|组织/.test(text)) return "权力如何塑造现实";
  if (/孤独|存在|死亡|命运/.test(text)) return "孤独如何保存清醒";
  if (/爱|家庭|伦理|照护/.test(text)) return "关系如何保存自我";
  if (/欲望|冲突|反抗|革命/.test(text)) return "欲望如何改变判断";
  return "旧答案为何失效";
}

function inferVisualArchetype(title: string, books: WeReadNotebook[], highlights: HighlightWithBook[]): string {
  const text = [
    title,
    ...books.map((nb) => `${nb.book?.title || ""} ${nb.book?.author || ""} ${nb.book?.category || ""}`),
    ...highlights.map((h) => h.markText || "")
  ].join(" ");
  if (/怀疑|证据|真实|真相|批判|逻辑|科学|技术|方法|结构/.test(text)) return "质疑";
  if (/权力|治理|战略|管理|组织|商业|经济|投资|决策/.test(text)) return "加冕";
  if (/冲突|反抗|愤怒|决裂|革命|越界|欲望/.test(text)) return "决断";
  if (/孤独|退隐|荒原|远方|沉默|死亡|存在/.test(text)) return "孤绝";
  if (/关系|照护|伦理|家庭|母亲|共情|责任/.test(text)) return "守护";
  if (/哲学|理念|抽象|本质|形而上|意义/.test(text)) return "辩思";
  if (/自由|美|身体|艺术|爱情|感受/.test(text)) return "盛放";
  if (/实践|现实|经验|规则|习惯|落地/.test(text)) return "落地";
  if (/ENFP|ESFP/.test(title)) return "繁生";
  if (/ENTP|ESTP/.test(title)) return "野性";
  if (/ISTJ|INTP/.test(title)) return "沉思";
  return "凝视";
}

function normalizeYearlyPersonality(
  rawItems: any[],
  books: WeReadNotebook[],
  highlights: HighlightWithBook[]
): CachedModeData["yearlyPersonality"] {
  const booksByYear = new Map<number, WeReadNotebook[]>();
  books.forEach((book, index) => {
    const year = getNotebookYear(book, index);
    booksByYear.set(year, [...(booksByYear.get(year) || []), book]);
  });

  const byYear = new Map<number, any>();
  (rawItems || []).forEach((item) => {
    const year = Number(item?.year);
    if (Number.isFinite(year)) byYear.set(year, item);
  });

  return Array.from(booksByYear.keys()).sort((a, b) => b - a).map((year) => {
    const item = byYear.get(year) || { year };
    const yearBooks = booksByYear.get(year) || [];
    const yearBookIds = new Set(yearBooks.map((book) => book.bookId));
    const yearHighlights = highlights.filter((highlight) => yearBookIds.has(highlight.bookId));
    const title = String(item?.title || "INFJ").toUpperCase().match(/\b[EI][NS][TF][JP]\b/)?.[0] || "INFJ";
    const visualArchetype = VISUAL_PERSONA_BY_ARCHETYPE[item?.visualArchetype]
      ? item.visualArchetype
      : inferVisualArchetype(title, yearBooks, yearHighlights);
    const artPersona = VISUAL_PERSONA_BY_ARCHETYPE[visualArchetype] || item?.artPersona || "蒙娜丽莎";
    const firstBook = yearBooks[0]?.book?.title ? `《${yearBooks[0].book.title}》` : "这一年的书目";

    return {
      year,
      title,
      annualQuestion: item?.annualQuestion || inferAnnualQuestion(yearBooks, yearHighlights),
      visualArchetype,
      artPersona,
      personaReason: item?.personaReason || `${firstBook}与划线内容共同指向${visualArchetype}这一视觉人格，因此对应${artPersona}的精神姿态。`,
      description: item?.description || `${title} 来自这一年的阅读主题、书籍分布与划线密度，显示你在意义、秩序和自我边界之间重新校准理解方式。`
    };
  });
}

function normalizeAnalysisShape(
  analysis: StoredAnalysis | any,
  books: WeReadNotebook[],
  highlights: HighlightWithBook[]
): StoredAnalysis | any {
  if (!analysis) return analysis;
  return {
    ...analysis,
    yearlyPersonality: normalizeYearlyPersonality(analysis.yearlyPersonality || [], books, highlights),
    thoughtClusters: Array.isArray(analysis.thoughtClusters) ? analysis.thoughtClusters : []
  };
}

function normalizeCategoryTitle(category?: string): string {
  const cleaned = (category || "")
    .replace(/^\[|\]$/g, "")
    .replace(/^["']|["']$/g, "")
    .trim();

  return cleaned || "未分类";
}

function buildPreferCategories(books: WeReadNotebook[], highlights: HighlightWithBook[]): PreferCategory[] {
  const highlightCountByBook = highlights.reduce<Record<string, number>>((acc, highlight) => {
    acc[highlight.bookId] = (acc[highlight.bookId] || 0) + 1;
    return acc;
  }, {});
  const categoryMap = new Map<string, { readingCount: number; readingTime: number }>();

  books.forEach((notebook) => {
    const categoryTitle = normalizeCategoryTitle(notebook.book?.category);
    const current = categoryMap.get(categoryTitle) || { readingCount: 0, readingTime: 0 };
    current.readingCount += 1;
    current.readingTime += Math.max(1, highlightCountByBook[notebook.bookId] || notebook.noteCount || 0);
    categoryMap.set(categoryTitle, current);
  });

  const totalReadingTime = Array.from(categoryMap.values()).reduce((sum, item) => sum + item.readingTime, 0) || 1;

  return Array.from(categoryMap.entries())
    .map(([categoryTitle, item], index) => ({
      categoryId: index,
      categoryTitle,
      readingCount: item.readingCount,
      readingTime: item.readingTime,
      val: Math.round((item.readingTime / totalReadingTime) * 1000) / 10
    }))
    .sort((a, b) => b.readingTime - a.readingTime || b.readingCount - a.readingCount || a.categoryTitle.localeCompare(b.categoryTitle, "zh-Hans-CN"))
    .map((item, index) => ({ ...item, categoryId: index }));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

export default function App() {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"canvas" | "swiper">("canvas");

  // Dual mode datasource state
  const [mode, setMode] = useState<DataMode>("weread");
  const [showObsidianModal, setShowObsidianModal] = useState<boolean>(false);

  // State elements
  const [notebooks, setNotebooks] = useState<WeReadNotebook[]>([]);
  const [stats, setStats] = useState<WeReadOverallStats | null>(null);
  const [highlights, setHighlights] = useState<HighlightWithBook[]>([]);
  
  // AI Analyzed States
  const [yearlyPersonality, setYearlyPersonality] = useState<CachedModeData["yearlyPersonality"]>([]);
  const [thoughtClusters, setThoughtClusters] = useState<Array<{ keyword: string; books: string[]; thoughtQuote: string }>>([]);
  const [isAiGenerated, setIsAiGenerated] = useState<boolean>(false);
  const [analysisModel, setAnalysisModel] = useState<string>(() => getStoredAnalysisApiConfig().model || "本地语义分析");
  const [analysisConnected, setAnalysisConnected] = useState<boolean>(false);
  const [analysisRetrying, setAnalysisRetrying] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState<boolean>(false);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const shouldShowWeReadOnboardingError = mode === "weread" && !getStoredApiKey().trim();
  const dataCacheRef = useRef<Partial<Record<DataMode, CachedModeData>>>({});
  const modeRef = useRef<DataMode>(mode);
  const analysisRunRef = useRef(0);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const applyCachedData = (cached: CachedModeData) => {
    setNotebooks(cached.notebooks);
    setStats(cached.stats);
    setHighlights(cached.highlights);
    setYearlyPersonality(cached.yearlyPersonality);
    setThoughtClusters(cached.thoughtClusters);
    setIsAiGenerated(cached.isAiGenerated);
    setAnalysisConnected(cached.analysisConnected);
    setAnalysisModel(cached.analysisModel);
  };

  const saveCachedData = (targetMode: DataMode, data: CachedModeData) => {
    dataCacheRef.current[targetMode] = data;
  };

  const readStoredAnalysis = (targetMode: DataMode, activeBooks: WeReadNotebook[], activeHighlights: HighlightWithBook[]): StoredAnalysis | null => {
    try {
      const exactKey = buildAnalysisCacheKey(targetMode, activeBooks, activeHighlights);
      const fallbackKey = `${LAST_ANALYSIS_KEY_PREFIX}:${targetMode}`;
      const exactRaw = localStorage.getItem(exactKey);
      if (exactRaw) {
        const parsed = JSON.parse(exactRaw);
        if (!parsed?.isAiGenerated) return null;
        return normalizeAnalysisShape(parsed, activeBooks, activeHighlights);
      }

      const fallbackRaw = localStorage.getItem(fallbackKey);
      if (!fallbackRaw) return null;
      const fallback = JSON.parse(fallbackRaw);
      if (!fallback?.isAiGenerated) return null;
      return normalizeAnalysisShape(fallback, activeBooks, activeHighlights);
    } catch (error) {
      console.warn("Failed to read local analysis cache.", error);
      return null;
    }
  };

  const writeStoredAnalysis = (targetMode: DataMode, activeBooks: WeReadNotebook[], activeHighlights: HighlightWithBook[], analysis: StoredAnalysis) => {
    try {
      const payload = JSON.stringify({
        ...analysis,
        sourceSignature: buildAnalysisSourceSignature(activeBooks, activeHighlights),
        savedAt: Date.now()
      });
      localStorage.setItem(
        buildAnalysisCacheKey(targetMode, activeBooks, activeHighlights),
        payload
      );
      localStorage.setItem(`${LAST_ANALYSIS_KEY_PREFIX}:${targetMode}`, payload);
    } catch (error) {
      console.warn("Failed to write local analysis cache.", error);
    }
  };

  const getCurrentSnapshot = (overrides: Partial<CachedModeData> = {}): CachedModeData => ({
    notebooks,
    stats,
    highlights,
    yearlyPersonality,
    thoughtClusters,
    isAiGenerated,
    analysisConnected,
    analysisModel,
    ...overrides
  });

  const runAnalysisForData = async (
    targetMode: DataMode,
    activeBooks: WeReadNotebook[],
    activeHighlights: HighlightWithBook[],
    baseSnapshot?: CachedModeData
  ) => {
    if (activeBooks.length === 0) return;
    const runId = ++analysisRunRef.current;

    try {
      setAnalysisRetrying(true);
      setAnalysisError(null);
      if (modeRef.current === targetMode) {
        setAnalysisConnected(false);
      }

      const analysis = normalizeAnalysisShape(
        await fetchAiAnalysis(activeBooks, activeHighlights),
        activeBooks,
        activeHighlights
      );
      if (runId !== analysisRunRef.current) return;

      const previousSnapshot = baseSnapshot || dataCacheRef.current[targetMode];
      const isFallback = !analysis?.isAiGenerated;
      const hasPreviousAiData = !!previousSnapshot?.isAiGenerated
        && previousSnapshot.yearlyPersonality.every((item) => item.annualQuestion && item.visualArchetype && item.artPersona && item.personaReason);
      const shouldKeepPrevious = isFallback && hasPreviousAiData;

      const nextSnapshot: CachedModeData = {
        ...(previousSnapshot || getCurrentSnapshot({
          notebooks: activeBooks,
          highlights: activeHighlights
        })),
        notebooks: activeBooks,
        highlights: activeHighlights,
        yearlyPersonality: shouldKeepPrevious ? previousSnapshot!.yearlyPersonality : (analysis?.yearlyPersonality || []),
        thoughtClusters: shouldKeepPrevious ? previousSnapshot!.thoughtClusters : (analysis?.thoughtClusters || []),
        isAiGenerated: shouldKeepPrevious ? true : !!analysis?.isAiGenerated,
        analysisConnected: shouldKeepPrevious ? true : !!analysis?.isAiGenerated,
        analysisModel: shouldKeepPrevious ? previousSnapshot!.analysisModel : (analysis?.analysisModel || getStoredAnalysisApiConfig().model || "本地语义分析")
      };

      if (nextSnapshot.isAiGenerated) {
        writeStoredAnalysis(targetMode, activeBooks, activeHighlights, {
          yearlyPersonality: nextSnapshot.yearlyPersonality,
          thoughtClusters: nextSnapshot.thoughtClusters,
          isAiGenerated: nextSnapshot.isAiGenerated,
          analysisConnected: nextSnapshot.analysisConnected,
          analysisModel: nextSnapshot.analysisModel
        });
      }

      saveCachedData(targetMode, nextSnapshot);
      if (modeRef.current === targetMode) {
        applyCachedData(nextSnapshot);
      }
    } catch (error: any) {
      if (runId === analysisRunRef.current) {
        const message = error?.message || "分析模型请求失败，请检查模型配置后重试。";
        setAnalysisError(message);
        setAnalysisConnected(false);
      }
    } finally {
      if (runId === analysisRunRef.current) {
        setAnalysisRetrying(false);
      }
    }
  };

  const loadData = async (targetMode: DataMode = mode, options: { force?: boolean } = {}) => {
    try {
      if (!options.force && dataCacheRef.current[targetMode]) {
        applyCachedData(dataCacheRef.current[targetMode]!);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      if (targetMode === "obsidian") {
        const storedStr = localStorage.getItem("weread_obsidian_payload");
        if (storedStr) {
          const stored = JSON.parse(storedStr);
          const loadedBooks = stored.books || [];
          const rawHighlights = stored.highlights || [];
          const cleanText = (text: string) => {
            return text
              .replace(/\s*\^[^\s]+$/g, "")
              .replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, "")
              .replace(/[\u{231A}-\u{231B}\u{23E9}-\u{23EC}\u{23F0}\u{23F3}\u{25FD}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2705}\u{2728}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2795}-\u{2797}\u{27B0}\u{27BF}]/gu, "")
              .trim();
          };
          const loadedHighlights = rawHighlights.map((lh: any) => ({
            ...lh,
            markText: lh.markText ? cleanText(lh.markText) : ""
          }));
          for (let i = loadedHighlights.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [loadedHighlights[i], loadedHighlights[j]] = [loadedHighlights[j], loadedHighlights[i]];
          }
          const localStats: WeReadOverallStats = {
            user: { name: "Obsidian 读者", avatar: "" },
            readingCount: loadedBooks.length,
            noteCount: loadedHighlights.length,
            readDays: 0,
            totalReadTime: 0,
            readStat: [
              { stat: "导入书籍", counts: `${loadedBooks.length}本` },
              { stat: "划线", counts: `${loadedHighlights.length}条` }
            ],
            preferCategory: buildPreferCategories(loadedBooks, loadedHighlights)
          };
          const snapshot: CachedModeData = {
            notebooks: loadedBooks,
            highlights: loadedHighlights,
            stats: localStats,
            yearlyPersonality: [],
            thoughtClusters: [],
            isAiGenerated: false,
            analysisConnected: false,
            analysisModel: getStoredAnalysisApiConfig().model || "本地语义分析",
            ...(readStoredAnalysis("obsidian", loadedBooks, loadedHighlights) || {})
          };
          saveCachedData("obsidian", snapshot);
          applyCachedData(snapshot);
          setLoading(false);
        } else {
          const emptySnapshot: CachedModeData = {
            notebooks: [],
            highlights: [],
            stats: null,
            yearlyPersonality: [],
            thoughtClusters: [],
            isAiGenerated: false,
            analysisConnected: false,
            analysisModel: getStoredAnalysisApiConfig().model || "本地语义分析"
          };
          saveCachedData("obsidian", emptySnapshot);
          applyCachedData(emptySnapshot);
        }
        setLoading(false);
        return;
      }

      // 1. Fetch bookshelf notebooks and general stats
      const [notebooksRes, statsRes] = await Promise.all([
        fetchNotebooks(),
        fetchOverallStats()
      ]);

      // 2. Fetch notes for every synced book in small batches so large libraries can complete.
      const notesByBook = await mapWithConcurrency(notebooksRes.books, 6, async (bookItem) => {
        try {
          const notesRes = await fetchBookNotes(bookItem.bookId);
          return (notesRes.updated || []).map((h) => ({
            ...h,
            bookName: bookItem.book.title,
            bookAuthor: bookItem.book.author,
            bookCover: bookItem.book.cover
          }));
        } catch (e) {
          console.warn(`Failed downloading notes for ${bookItem.bookId}`, e);
          return [];
        }
      });

      const resolvedHighlights = notesByBook.flat();
      
      // Shuffle highlights randomly instead of sorting by book/time
      for (let i = resolvedHighlights.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [resolvedHighlights[i], resolvedHighlights[j]] = [resolvedHighlights[j], resolvedHighlights[i]];
      }
      const snapshot: CachedModeData = {
        notebooks: notebooksRes.books,
        stats: statsRes,
        highlights: resolvedHighlights,
        yearlyPersonality: [],
        thoughtClusters: [],
        isAiGenerated: false,
        analysisConnected: false,
        analysisModel: getStoredAnalysisApiConfig().model || "本地语义分析",
        ...(readStoredAnalysis("weread", notebooksRes.books, resolvedHighlights) || {})
      };
      saveCachedData("weread", snapshot);
      applyCachedData(snapshot);
      setLoading(false);

    } catch (err: any) {
      console.error(err);
      setError(err?.message || "无法拉取微信读书数据，请检查网关和认证Key配置。");
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchMode = (target: DataMode) => {
    setSelectedBookId(null);
    localStorage.setItem("weread_active_mode", target);
    setMode(target);
    modeRef.current = target;
    loadData(target);
  };

  const handleWeReadSettingsRefresh = () => {
    setSelectedBookId(null);
    delete dataCacheRef.current.weread;
    localStorage.setItem("weread_active_mode", "weread");
    setMode("weread");
    modeRef.current = "weread";
    loadData("weread", { force: true });
  };

  const handleImportComplete = (imported: { books: any[]; highlights: any[] }) => {
    setSelectedBookId(null);
    localStorage.setItem("weread_obsidian_payload", JSON.stringify(imported));
    setShowObsidianModal(false);
    delete dataCacheRef.current.obsidian;
    setMode("obsidian");
    modeRef.current = "obsidian";
    loadData("obsidian", { force: true });
  };

  const clearObsidianData = () => {
    if (confirm("确定要清除本地 Obsidian 导入的书籍和划线记录吗？")) {
      localStorage.removeItem("weread_obsidian_payload");
      delete dataCacheRef.current.obsidian;
      setSelectedBookId(null);
      loadData("obsidian", { force: true });
    }
  };

  const rebuildStatsForLocalData = (books: WeReadNotebook[], activeHighlights: typeof highlights): WeReadOverallStats => ({
    user: { name: "Obsidian 读者", avatar: "" },
    readingCount: books.length,
    noteCount: activeHighlights.length,
    readDays: 0,
    totalReadTime: 0,
    readStat: [
      { stat: "导入书籍", counts: `${books.length}本` },
      { stat: "划线", counts: `${activeHighlights.length}条` }
    ],
    preferCategory: buildPreferCategories(books, activeHighlights)
  });

  const deleteBookById = async (bookId: string | null) => {
    if (!bookId) return;

    const nextBooks = notebooks.filter((nb) => nb.bookId !== bookId);
    const nextHighlights = highlights.filter((h) => h.bookId !== bookId);

    setNotebooks(nextBooks);
    setHighlights(nextHighlights);
    setSelectedBookId(null);

    if (mode === "obsidian") {
      localStorage.setItem("weread_obsidian_payload", JSON.stringify({
        books: nextBooks,
        highlights: nextHighlights
      }));
      const nextStats = rebuildStatsForLocalData(nextBooks, nextHighlights);
      setStats(nextStats);
      saveCachedData("obsidian", getCurrentSnapshot({
        notebooks: nextBooks,
        highlights: nextHighlights,
        stats: nextStats
      }));
    }

    if (nextBooks.length === 0) {
      setYearlyPersonality([]);
      setThoughtClusters([]);
      setIsAiGenerated(false);
      setAnalysisConnected(false);
    }
  };

  const deleteSelectedBook = async () => {
    await deleteBookById(selectedBookId);
  };

  const handleAnalysisConfigSaved = (config: AnalysisApiConfig, connected: boolean) => {
    setAnalysisModel(config.model || "未命名模型");
    setAnalysisConnected(connected);
    setAnalysisError(null);
  };

  const retryAnalysis = async () => {
    if (notebooks.length === 0) return;
    await runAnalysisForData(modeRef.current, notebooks, highlights);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input") ||
        target?.closest("textarea") ||
              target?.closest("select") ||
              target?.closest("[contenteditable='true']") ||
              target?.closest("#settings-panel") ||
              target?.closest("#analysis-settings-panel") ||
              target?.closest("#obsidian-importer-panel")
      ) {
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selectedBookId) {
        event.preventDefault();
        deleteSelectedBook();
      }
      if (event.key === "Escape") {
        setSelectedBookId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedBookId, notebooks, highlights, mode]);

  return (
    <div className="w-screen h-screen flex flex-col font-sans text-ink-dark bg-[#FAF9F6]">
      
      {/* Top Desk Bar */}
      <header className="h-14 border-b border-[#2C2C26]/10 bg-white/40 backdrop-blur-md flex items-center justify-between px-6 z-[120] shadow-2xs flex-shrink-0">
        <div className="flex items-center gap-5">
          <div className="flex flex-col">
            <h1 className="font-serif font-normal text-sm md:text-base tracking-tight text-[#2C2C26] flex items-center gap-1.5 leading-none">
              我的阅读数据图谱
            </h1>
            <p className="text-[9px] text-[#2C2C26]/45 uppercase tracking-widest font-sans mt-0.5">
              Insights Interface
            </p>
          </div>

          <div className="hidden md:block h-6 w-px bg-[#2C2C26]/12"></div>

          {/* Segmented DataSource Switcher */}
          <div className="hidden md:flex items-center bg-[#2C2C26]/4 rounded-full p-0.5 border border-[#2C2C26]/8 text-xs font-sans">
            <button
              onClick={() => handleSwitchMode("weread")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-medium tracking-wide transition-all cursor-pointer ${
                mode === "weread" 
                  ? "bg-white text-[#2C2C26] shadow-[0_1px_2px_rgba(44,44,38,0.08)] font-semibold border border-[#2C2C26]/5" 
                  : "text-[#2C2C26]/60 hover:text-[#2C2C26] hover:bg-[#2C2C26]/3"
              }`}
            >
              <BookOpen className={`w-3.5 h-3.5 transition-colors ${mode === "weread" ? "text-emerald-700" : "text-[#2C2C26]/40"}`} />
              <span>微信读书 API</span>
            </button>
            <button
              onClick={() => handleSwitchMode("obsidian")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-medium tracking-wide transition-all cursor-pointer ${
                mode === "obsidian" 
                  ? "bg-white text-[#2C2C26] shadow-[0_1px_2px_rgba(44,44,38,0.08)] font-semibold border border-[#2C2C26]/5" 
                  : "text-[#2C2C26]/60 hover:text-[#2C2C26] hover:bg-[#2C2C26]/3"
              }`}
            >
              <FileText className={`w-3.5 h-3.5 transition-colors ${mode === "obsidian" ? "text-amber-700" : "text-[#2C2C26]/40"}`} />
              <span>Obsidian 导入</span>
            </button>
          </div>
        </div>

        {/* View Switchers for split layouts */}
        <div className="flex items-center gap-3">
          {/* Obsidian-specific Upload/Clear Actions */}
          <AnalysisSettingsPanel onSaved={handleAnalysisConfigSaved} />

          {mode === "obsidian" && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowObsidianModal(true)}
                className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-[#2C2C26]/5 text-[#2C2C26] border border-[#2C2C26]/10 rounded-md shadow-sm font-sans text-sm transition-all duration-300 cursor-pointer"
                title="增量上传 markdown 笔记"
              >
                <PlusCircle className="w-4 h-4 text-[#2C2C26]" />
                <span className="hidden sm:inline">导入 Obsidian 笔记</span>
              </button>
              {notebooks.length > 0 && (
                <button
                  onClick={clearObsidianData}
                  className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-red-50 text-[#2C2C26] hover:text-red-600 border border-[#2C2C26]/10 hover:border-red-200 rounded-md shadow-sm font-sans text-sm transition-all duration-300 cursor-pointer group"
                  title="清空导入数据"
                >
                  <Trash2 className="w-4 h-4 text-[#2C2C26]/70 group-hover:text-red-500 transition-colors" />
                  <span className="hidden sm:inline">清空数据</span>
                </button>
              )}
            </div>
          )}

          {/* Mobile/Tablet switch mode select */}
          <div className="flex md:hidden items-center text-xs">
            <select
              value={mode}
              onChange={(e) => handleSwitchMode(e.target.value as "weread" | "obsidian")}
              className="bg-white px-2 py-1.5 border border-[#2C2C26]/10 rounded font-medium text-[#2C2C26] text-xs focus:outline-none"
            >
              <option value="weread">📖 微信读书 API</option>
              <option value="obsidian">🪨 Obsidian 导入</option>
            </select>
          </div>

          {/* Manual Data Sync Button (for WeRead API only) */}
          {mode === "weread" && (
            <button
              onClick={() => loadData("weread", { force: true })}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-[#2C2C26]/5 text-[#2C2C26] border border-[#2C2C26]/10 rounded-md shadow-sm font-sans text-xs transition-all duration-300 cursor-pointer disabled:opacity-50"
              title="拉取并更新最新划线与书籍数据"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{loading ? "同步中..." : "同步数据"}</span>
            </button>
          )}

          {/* Tab selectors for small screens */}
          <div className="flex items-center rounded-lg bg-[#2C2C26]/5 p-1 text-xs sm:hidden">
            <button
              onClick={() => setTab("canvas")}
              className={`px-3 py-1 rounded-md transition-all font-sans text-[10px] font-medium tracking-wider uppercase ${
                tab === "canvas" ? "bg-white text-ink-dark shadow-xs" : "text-[#2C2C26]/60"
              }`}
            >
              🎨 无限图谱
            </button>
            <button
              onClick={() => setTab("swiper")}
              className={`px-3 py-1 rounded-md transition-all font-sans text-[10px] font-medium tracking-wider uppercase ${
                tab === "swiper" ? "bg-white text-ink-dark shadow-xs" : "text-[#2C2C26]/60"
              }`}
            >
              📱 随感划线
            </button>
          </div>

          {mode === "weread" && (
            <SettingsPanel onRefresh={handleWeReadSettingsRefresh} isLoading={loading} initiallyOpen />
          )}
        </div>
      </header>

      {/* Main split work space */}
      <div className="flex-1 flex overflow-hidden relative bg-[#FAF9F6]">
        
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#FAF9F6]/95 z-40 font-sans">
            <div className="relative">
              <Compass className="w-12 h-12 text-[#2C2C26]/40 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center text-[10px] text-[#2C2C26] font-normal font-serif">
                阅
              </div>
            </div>
            <p className="text-sm font-serif text-[#2C2C26]/80 mt-4 tracking-normal">
              正在解构数据图谱并检索心智线索...
            </p>
            <p className="text-[10px] font-sans text-[#2C2C26]/40 mt-1 uppercase tracking-widest font-semibold">
              Please wait while we chart the contours
            </p>
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#FAF9F6] z-40 text-center p-6_font-sans">
            <AlertCircle className="w-14 h-14 text-red-600/60 mb-4" />
            <h3 className="font-serif font-normal text-lg text-ink-dark mb-1">
              {shouldShowWeReadOnboardingError ? "需要添加微信读书skill api" : "读书数据获取失败"}
            </h3>
            <p className="text-xs text-[#2C2C26]/70 max-w-sm leading-relaxed mb-6 font-sans">
              {shouldShowWeReadOnboardingError
                ? "前往微信读书右上角设置，找到微信读书skill，找到快速配置2:将api复制到本网页右上角弹窗的API密钥中（注意 API 不要透露给任何人，本网站也不会存储）"
                : error}
            </p>
            <button
              onClick={() => loadData(mode)}
              className="px-4 py-2 bg-[#2C2C26] hover:bg-[#2C2C26]/90 text-white text-xs tracking-wider font-sans rounded border border-[#2C2C26]/20 shadow-xs flex items-center gap-1.5 transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              重新尝试连接
            </button>
          </div>
        ) : (
          <>
            {/* LEFT STAGE: Infinite Canvas featuring three detailed maps */}
            <div className={`flex-1 h-full relative ${tab === "canvas" ? "block" : "hidden sm:block"}`}>
              {mode === "obsidian" && notebooks.length === 0 ? (
                <div className="absolute inset-0 bg-[#FAF9F6] flex flex-col items-center justify-center p-6 z-10 overflow-y-auto">
                  <div className="max-w-xl w-full bg-white border border-[#2C2C26]/12 rounded-xl p-8 shadow-sm flex flex-col gap-6">
                    <div className="text-center space-y-1">
                      <FolderSync className="w-12 h-12 text-amber-700 mx-auto mb-2" />
                      <h3 className="font-serif font-normal text-lg">🪨 本地 Obsidian 划线导入器</h3>
                      <p className="text-xs text-[#2C2C26]/65 leading-relaxed">
                        无需任何微信 API 转发，完全沙箱隐私安全。我们将为您直接在前端解析 Markdown 文件并还原精致思维导图与成长阶梯！
                      </p>
                    </div>
                    
                    <ObsidianImporter onImportComplete={handleImportComplete} />
                  </div>
                </div>
              ) : (
                <InfiniteCanvas onBlankClick={() => setSelectedBookId(null)}>
                  
                  {/* Floating source indicator in canvas - left-aligned with content blocks at left 100px */}
                  <div className="absolute" style={{ left: "100px", top: "30px", zIndex: 40 }}>
                    <div className="flex items-center gap-2">
                    <div className="bg-white/85 backdrop-blur-md px-3.5 py-1.5 border border-[#2C2C26]/12 rounded-full text-[10px] font-medium font-sans flex items-center gap-2 shadow-2xs pointer-events-none">
                      <span className="flex h-2 w-2 relative">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${notebooks.length > 0 ? "bg-emerald-500" : "bg-amber-500"}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${notebooks.length > 0 ? "bg-emerald-600" : "bg-amber-600"}`}></span>
                      </span>
                      <span className="text-[#2C2C26]/85">数据源：{mode === "obsidian" ? `本地 Obsidian 有效记录 (${notebooks.length}本)` : "微信读书 API 在线托管"}</span>
                    </div>
                    <div className="bg-white/85 backdrop-blur-md px-3.5 py-1.5 border border-[#2C2C26]/12 rounded-full text-[10px] font-medium font-sans flex items-center gap-2 shadow-2xs">
                      <span className="flex h-2 w-2 relative">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${analysisConnected ? "bg-emerald-500" : "bg-amber-500"}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${analysisConnected ? "bg-emerald-600" : "bg-amber-600"}`}></span>
                      </span>
                      <BrainCircuit className="w-3 h-3 text-[#2C2C26]/55" />
                      <span className="max-w-[260px] truncate text-[#2C2C26]/85" title={analysisModel}>
                        分析模型：{analysisModel}
                      </span>
                      {notebooks.length > 0 && (
                        <button
                          type="button"
                          onClick={retryAnalysis}
                          disabled={analysisRetrying}
                          className="ml-1 flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#2C2C26]/10 bg-white hover:bg-[#2C2C26]/5 disabled:opacity-50 text-[#2C2C26]/70 cursor-pointer pointer-events-auto"
                          title="重新连接分析模型并生成年度阅读人格"
                        >
                          <RefreshCw className={`w-3 h-3 ${analysisRetrying ? "animate-spin" : ""}`} />
                          {analysisRetrying ? "分析中" : "重试"}
                        </button>
                      )}
                    </div>
                    {analysisError && (
                      <div className="bg-red-50/95 backdrop-blur-md px-3.5 py-1.5 border border-red-200 rounded-full text-[10px] font-medium font-sans flex items-center gap-2 shadow-2xs max-w-[520px]">
                        <AlertCircle className="w-3 h-3 text-red-600 flex-shrink-0" />
                        <span className="truncate text-red-700" title={analysisError}>
                          分析失败：{analysisError}
                        </span>
                      </div>
                    )}
                    </div>
                  </div>

                  {/* Adaptive flowing layout wrapper for blocks to prevent any overlaps or truncation */}
                  <div className="absolute left-[100px] top-[80px] w-[5900px] flex gap-[140px]">
                    {/* LEFT COLUMN: GROWTH MAP */}
                    <div className="w-[2300px] flex-shrink-0">
                      <GrowthMap
                        notebooks={notebooks}
                        yearlyPersonality={yearlyPersonality}
                        isAiGenerated={isAiGenerated}
                        onReanalyze={retryAnalysis}
                        isAnalyzing={analysisRetrying}
                        selectedBookId={selectedBookId}
                        onSelectBook={setSelectedBookId}
                        onDeleteBook={deleteBookById}
                      />
                    </div>

                    {/* MIDDLE+RIGHT: READING TRENDS & EVOLUTION MAP side-by-side, then COGNITIVE LANDSCAPE below */}
                    <div className="flex-shrink-0 flex flex-col gap-[120px]">
                      <div className="flex gap-[140px] items-stretch">
                        <div className="w-[1700px] flex-shrink-0">
                          <ReadingTrends
                            notebooks={notebooks}
                            stats={stats}
                            highlights={highlights}
                            onReanalyze={retryAnalysis}
                            isAnalyzing={analysisRetrying}
                          />
                        </div>
                        <div className="w-[1700px] flex-shrink-0">
                          <RelationshipMap
                            thoughtClusters={thoughtClusters}
                            notebooks={notebooks}
                            highlights={highlights}
                            onReanalyze={retryAnalysis}
                            isAnalyzing={analysisRetrying}
                          />
                        </div>
                      </div>
                      <div className="w-full">
                        <CognitiveLandscape
                          notebooks={notebooks}
                          highlights={highlights}
                          preferCategory={stats?.preferCategory || []}
                          onReanalyze={retryAnalysis}
                          isAnalyzing={analysisRetrying}
                        />
                      </div>
                    </div>
                  </div>

                </InfiniteCanvas>
              )}

              {/* Collapsible Panel Hover Area & Toggle Button */}
              <div className="absolute right-0 top-0 hidden h-full w-14 z-40 sm:flex items-center justify-end group">
                <button
                  type="button"
                  onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
                  aria-expanded={!rightPanelCollapsed}
                  aria-label={rightPanelCollapsed ? "展开划线卡片" : "收起划线卡片"}
                  className="mr-0 flex h-24 w-8 items-center justify-center rounded-l-lg border border-r-0 border-[#2C2C26]/18 bg-white/92 text-[#2C2C26]/58 shadow-sm backdrop-blur-md transition-all duration-200 opacity-0 translate-x-2 group-hover:translate-x-0 group-hover:opacity-100 hover:bg-[#FAF9F6] hover:text-[#2C2C26] focus:translate-x-0 focus:opacity-100 cursor-pointer"
                  title={rightPanelCollapsed ? "展开划线卡片" : "收起划线卡片"}
                >
                  {rightPanelCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* RIGHT STAGE: Book highlights card swiper feed. Fixed on desktop for fluid experience */}
            <div 
              className={`border-[#2C2C26]/10 bg-white/40 flex flex-col items-center justify-center relative flex-shrink-0 z-20 transition-all duration-300 ease-in-out border-l ${
                tab === "swiper" 
                  ? "w-full flex" 
                  : (rightPanelCollapsed 
                      ? "w-0 border-l-0 overflow-hidden hidden sm:flex" 
                      : "w-full sm:w-[410px] flex sm:flex")
              }`}
            >
              
              {/* Vertical clip representing handcraft wire ties */}
              <div className="absolute top-0 bottom-0 left-0 w-[1px] bg-[#2C2C26]/10"></div>

              <div className="w-full h-full flex flex-col items-center justify-center p-6">
                {highlights.length > 0 ? (
                  <CardSwiper notebooks={notebooks} highlights={highlights} />
                ) : (
                  <div className="py-20 text-center text-[#2C2C26]/60 font-serif max-w-xs px-6">
                    <Quote className="w-8 h-8 mx-auto mb-3 opacity-30 text-[#2C2C26]" />
                    <p className="text-sm">暂无图书划线记忆</p>
                    <p className="text-[10px] font-sans text-gray-400 mt-1 leading-relaxed">
                      该账户尚未在本应用的这些同步书籍下作任何内容摘录或划线备注。请点击右上角「导入 Obsidian 笔记」或切换为「微信读书 API」数据源。
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Obsidian incremental import dialogue modal */}
      {showObsidianModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-[100] p-4 font-sans animate-fade-in">
          <div className="bg-white border border-[#2C2C26]/15 rounded-xl shadow-lg max-w-lg w-full p-6 relative">
            <button
              onClick={() => setShowObsidianModal(false)}
              className="absolute top-4 right-4 text-[#2C2C26]/40 hover:text-[#2C2C26] cursor-pointer"
            >
              <span className="font-sans text-base">✕</span>
            </button>
            <h3 className="font-serif font-normal text-md text-[#2C2C26] mb-3 flex items-center gap-1.5">
              <FolderSync className="w-5 h-5 text-amber-700" />
              <span>导入 Obsidian (.md) 笔记文件夹</span>
            </h3>
            <ObsidianImporter 
              onImportComplete={handleImportComplete} 
              onClose={() => setShowObsidianModal(false)} 
            />
          </div>
        </div>
      )}
    </div>
  );
}
