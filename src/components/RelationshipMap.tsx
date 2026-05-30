/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from "react";
import { Compass, Download, RefreshCw } from "lucide-react";
import { toPng } from "html-to-image";
import { WeReadHighlight, WeReadNotebook } from "../types";
import BookCover from "./BookCover";
import { getNotebookTimeInfo } from "../utils/wereadDates";

type HighlightWithBook = Partial<WeReadHighlight> & {
  bookName?: string;
  bookAuthor?: string;
  bookCover?: string;
};

interface RelationshipMapProps {
  thoughtClusters: Array<{ keyword: string; books: string[]; thoughtQuote: string }>;
  notebooks: WeReadNotebook[];
  highlights: HighlightWithBook[];
  onReanalyze?: () => void;
  isAnalyzing?: boolean;
}

interface ParsedBookItem {
  nb: WeReadNotebook;
  year: number;
  month: number;
  time: number;
  estimated: boolean;
  categoryIndex: number;
  categoryTitle: string;
  highlightCount: number;
  readingMinutes: number;
  radius: number;
  x: number;
  y: number;
}

interface HoveredJourneyBook extends ParsedBookItem {
  mouseX: number;
  mouseY: number;
}

const CATEGORY_COLUMNS = [
  {
    label: "文学小说",
    subtitle: "LITERATURE",
    tone: "bg-[#2C2C26]",
    fill: "rgba(44,44,38,1)",
    keywords: ["文学", "小说", "经典", "诗", "散文", "随笔", "艺术", "传记", "fiction", "literature", "novel"],
  },
  {
    label: "哲学思想",
    subtitle: "PHILOSOPHY",
    tone: "bg-[#2C2C26]/80",
    fill: "rgba(44,44,38,0.80)",
    keywords: ["哲学", "思想", "宗教", "存在", "自由", "意义", "伦理", "哲学宗教", "philosophy"],
  },
  {
    label: "心理学",
    subtitle: "PSYCHOLOGY",
    tone: "bg-[#2C2C26]/65",
    fill: "rgba(44,44,38,0.65)",
    keywords: ["心理", "精神", "梦", "人格", "自我", "认知", "习惯", "psychology"],
  },
  {
    label: "历史社会",
    subtitle: "HISTORY / SOCIETY",
    tone: "bg-[#2C2C26]/50",
    fill: "rgba(44,44,38,0.50)",
    keywords: ["历史", "社会", "政治", "文化", "人类", "传播", "媒介", "社会科学", "history", "society"],
  },
  {
    label: "科技未来",
    subtitle: "SCIENCE & TECH",
    tone: "bg-[#2C2C26]/42",
    fill: "rgba(44,44,38,0.42)",
    keywords: ["科技", "科学", "技术", "ai", "人工智能", "算法", "未来", "互联网", "代码", "science", "tech"],
  },
  {
    label: "经济商业",
    subtitle: "BUSINESS",
    tone: "bg-[#2C2C26]/58",
    fill: "rgba(44,44,38,0.58)",
    keywords: ["经济", "商业", "管理", "金融", "理财", "投资", "财富", "business", "economics"],
  },
  {
    label: "艺术设计",
    subtitle: "ART & DESIGN",
    tone: "bg-[#2C2C26]/34",
    fill: "rgba(44,44,38,0.34)",
    keywords: ["设计", "美学", "艺术", "建筑", "绘画", "摄影", "art", "design"],
  },
  {
    label: "其他",
    subtitle: "OTHERS",
    tone: "bg-[#2C2C26]/72",
    fill: "rgba(44,44,38,0.72)",
    keywords: [],
  },
];

const CHART_TOP = 92;
const CHART_BOTTOM_PADDING = 56;
const GROWTH_YEAR_BLOCK_HEIGHT = 220;
const GROWTH_YEAR_GAP = 48;
const GROWTH_FIXED_HEIGHT = 188;

function getChartMetrics(containerWidth: number) {
  const chartLeft = Math.max(170, Math.round(containerWidth * 0.1));
  const chartRight = Math.max(95, Math.round(containerWidth * 0.056));
  const chartWidth = containerWidth - chartLeft - chartRight;
  const categoryStep = chartWidth / (CATEGORY_COLUMNS.length - 1);
  return { chartLeft, chartRight, chartWidth, categoryStep };
}

function getGrowthLikeHeight(yearCount: number) {
  const count = Math.max(1, yearCount);
  return GROWTH_FIXED_HEIGHT + count * GROWTH_YEAR_BLOCK_HEIGHT + Math.max(0, count - 1) * GROWTH_YEAR_GAP;
}

function getRowHeight(yearCount: number, availableHeight?: number) {
  if (availableHeight && availableHeight > CHART_TOP + CHART_BOTTOM_PADDING) {
    return (availableHeight - CHART_TOP - CHART_BOTTOM_PADDING) / Math.max(1, yearCount);
  }
  return (getGrowthLikeHeight(yearCount) - CHART_TOP - CHART_BOTTOM_PADDING) / Math.max(1, yearCount);
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function cleanTitle(value?: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function classifyCategory(nb: WeReadNotebook) {
  const text = [
    nb.book.title,
    nb.book.author,
    nb.book.category,
    ...(nb.book.categories || []).map((category) => category.title),
  ].join(" ").toLowerCase();

  const foundIndex = CATEGORY_COLUMNS.findIndex((category) =>
    category.keywords.some((keyword) => text.includes(keyword.toLowerCase()))
  );
  return foundIndex >= 0 ? foundIndex : CATEGORY_COLUMNS.length - 1;
}

function buildCurve(fromX: number, fromY: number, toX: number, toY: number, bend = 0.5) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const c1x = fromX + dx * bend;
  const c1y = fromY + dy * 0.16;
  const c2x = toX - dx * bend;
  const c2y = toY - dy * 0.16;
  return `M ${fromX} ${fromY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${toX} ${toY}`;
}

function buildParsedBooks(notebooks: WeReadNotebook[], highlights: HighlightWithBook[], containerWidth: number, availableHeight?: number) {
  const { chartLeft, categoryStep } = getChartMetrics(containerWidth);
  const highlightCountByBook = highlights.reduce<Record<string, number>>((acc, highlight) => {
    if (highlight.bookId) acc[highlight.bookId] = (acc[highlight.bookId] || 0) + 1;
    return acc;
  }, {});

  const baseItems = notebooks.map((nb, idx) => {
    const timeInfo = getNotebookTimeInfo(nb, idx);
    const categoryIndex = classifyCategory(nb);
    const highlightCount = highlightCountByBook[nb.bookId] || nb.noteCount || 0;
    const readingWeight = Math.max(1, (nb.noteCount || 0) + highlightCount);
    const readingMinutes = Math.max(8, Math.round((nb.noteCount || 1) * 12 + highlightCount * 4 + (nb.markedStatus === 1 ? 30 : 0)));
    return {
      nb,
      ...timeInfo,
      categoryIndex,
      categoryTitle: CATEGORY_COLUMNS[categoryIndex].label,
      highlightCount,
      readingMinutes,
      radius: Math.max(6, Math.min(18, 5 + Math.sqrt(readingWeight) * 2.3)),
    };
  });

  const years = Array.from(new Set(baseItems.map((item) => item.year))).sort((a, b) => a - b);
  const yearCount = years.length || 4;

  const rowHeight = getRowHeight(yearCount, availableHeight);

  const yearIndexMap = new Map(years.map((year, index) => [year, index]));
  const clusteredPositions = new Map<string, { index: number; total: number }>();
  const groupedByYearCategory = new Map<string, typeof baseItems>();

  baseItems.forEach((item) => {
    const key = `${item.year}-${item.categoryIndex}`;
    const group = groupedByYearCategory.get(key) || [];
    group.push(item);
    groupedByYearCategory.set(key, group);
  });

  groupedByYearCategory.forEach((group) => {
    group.sort((a, b) => a.time - b.time).forEach((item, index) => {
      clusteredPositions.set(item.nb.bookId, { index, total: group.length });
    });
  });

  const parsed: ParsedBookItem[] = baseItems
    .map((item) => {
      const jitterSeed = hashString(`${item.nb.bookId}-${item.nb.book.title}`);
      const xJitter = ((jitterSeed % 101) - 50) * 0.84;
      const monthY = (item.month / 11) * Math.max(120, rowHeight - 110);
      const cluster = clusteredPositions.get(item.nb.bookId);
      const stackOffset = cluster ? (cluster.index - (cluster.total - 1) / 2) * Math.min(44, Math.max(20, rowHeight / 6.5)) : 0;
      const rowIndex = yearIndexMap.get(item.year) || 0;
      const rawY = CHART_TOP + rowIndex * rowHeight + 38 + monthY + stackOffset;
      const minY = CHART_TOP + rowIndex * rowHeight + 30;
      const maxY = CHART_TOP + (rowIndex + 1) * rowHeight - 28;
      return {
        ...item,
        x: chartLeft + item.categoryIndex * categoryStep + xJitter,
        y: Math.max(minY, Math.min(maxY, rawY)),
      };
    })
    .sort((a, b) => a.time - b.time);

  return { parsed, years, rowHeight };
}

export default function RelationshipMap({ notebooks, highlights, onReanalyze, isAnalyzing }: RelationshipMapProps) {
  const [hoveredBook, setHoveredBook] = useState<HoveredJourneyBook | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [availableSize, setAvailableSize] = useState<{ width: number; height: number } | undefined>(undefined);

  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;

    const updateSize = (entry?: ResizeObserverEntry) => {
      const width = entry?.contentRect.width || el.clientWidth;
      const height = entry?.contentRect.height || el.clientHeight;
      if (width > 0 && height > 0) {
        setAvailableSize((current) => {
          const next = { width: Math.round(width), height: Math.round(height) };
          if (current?.width === next.width && current?.height === next.height) return current;
          return next;
        });
      }
    };
    updateSize();

    const observer = new ResizeObserver((entries) => updateSize(entries[0]));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const svgWidth = availableSize?.width || 1700;
  const { chartLeft, chartRight, categoryStep } = getChartMetrics(svgWidth);
  const { parsed, years, rowHeight } = buildParsedBooks(notebooks, highlights, svgWidth, availableSize?.height);
  const activeYears = years.length > 0 ? years : [2023, 2024, 2025, 2026];
  const chartHeight = activeYears.length * rowHeight;
  const containerHeight = availableSize?.height || getGrowthLikeHeight(activeYears.length);
  const categoryGroups = CATEGORY_COLUMNS.map((_, index) => parsed.filter((item) => item.categoryIndex === index).sort((a, b) => a.time - b.time));

  const handleDownload = () => {
    const element = document.getElementById("relationship-map-container");
    if (!element) return;

    toPng(element, {
      backgroundColor: "#FAF9F6",
      style: {
        transform: "scale(1)",
        transformOrigin: "top left",
      },
      filter: (domNode: any) => {
        if (domNode.classList && domNode.classList.contains("download-btn")) {
          return false;
        }
        return true;
      },
      cacheBust: true,
    })
      .then((dataUrl) => {
        const link = document.createElement("a");
        link.download = "WeRead-阅读演化地图.png";
        link.href = dataUrl;
        link.click();
      })
      .catch((err) => {
        console.error("Failed to export reading journey map image:", err);
      });
  };

  return (
    <div
      ref={containerRef}
      className="p-8 bg-white/40 backdrop-blur-md border border-[#2C2C26]/10 rounded-xl shadow-xs w-[1700px] min-h-[980px] h-full font-sans text-[#2C2C26] select-none relative flex flex-col"
      id="relationship-map-container"
    >
      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 flex gap-12 z-10">
        <div className="w-16 h-1 bg-[#2C2C26]/10 rounded-full"></div>
      </div>

      <div className="flex items-center justify-between border-b border-[#2C2C26]/10 pb-4 mb-4 flex-shrink-0">
        <div>
          <h2 className="font-serif font-normal text-xl text-[#2C2C26] tracking-tight flex items-center gap-2">
            <Compass className="w-5 h-5 text-[#2C2C26]/60" />
            阅读演化地图
          </h2>
          <p className="text-[9px] text-[#2C2C26]/50 mt-1 uppercase tracking-widest font-sans">
            THE INTERSECTION OF TIME, GENRES AND BOOKS
          </p>
        </div>

        <div className="flex items-center gap-3">
          {onReanalyze && (
            <button
              onClick={onReanalyze}
              disabled={isAnalyzing}
              className="download-btn flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-[#2C2C26]/5 border border-[#2C2C26]/20 hover:border-[#2C2C26]/40 rounded text-[10px] text-[#2C2C26] font-mono shadow-3xs cursor-pointer transition-all disabled:opacity-50"
              title="调用分析模型重新生成全部图谱内容"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#2C2C26]/70 ${isAnalyzing ? "animate-spin" : ""}`} />
              <span>{isAnalyzing ? "分析中" : "重新分析"}</span>
            </button>
          )}
          <button
            onClick={handleDownload}
            className="download-btn flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-[#2C2C26]/5 border border-[#2C2C26]/20 hover:border-[#2C2C26]/40 rounded text-[10px] text-[#2C2C26] font-mono shadow-3xs cursor-pointer transition-all"
            title="保存为 PNG 图片到本地"
          >
            <Download className="w-3.5 h-3.5 text-[#2C2C26]/70" />
            <span>保存图谱</span>
          </button>
        </div>
      </div>

      <div ref={chartAreaRef} className="relative flex-1 min-h-0">
        <svg ref={svgRef} className="absolute left-0 top-0 w-full h-full" viewBox={`0 0 ${svgWidth} ${containerHeight}`}>
          <defs>
            <marker id="journey-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
              <path d="M 0 1 L 6 4 L 0 7" fill="none" stroke="rgba(44,44,38,0.34)" strokeWidth="1.2" />
            </marker>
          </defs>

          {CATEGORY_COLUMNS.map((category, index) => {
            const x = chartLeft + index * categoryStep;
            return (
              <g key={`column-${category.label}`}>
                <line x1={x} y1={CHART_TOP - 12} x2={x} y2={CHART_TOP + chartHeight - 8} stroke="rgba(44,44,38,0.10)" strokeWidth="1" strokeDasharray="2 4" />
                <text x={x} y={CHART_TOP - 52} textAnchor="middle" className="font-serif" fontSize="16" fill="#2C2C26">{category.label}</text>
                <text x={x} y={CHART_TOP - 36} textAnchor="middle" className="font-mono" fontSize="9" fill="rgba(44,44,38,0.55)" letterSpacing="0.08em">{category.subtitle}</text>
              </g>
            );
          })}

          {activeYears.map((year, index) => {
            const y = CHART_TOP + index * rowHeight;
            return (
              <g key={`year-${year}`}>
                <line x1={chartLeft - 100} x2={svgWidth - chartRight} y1={y} y2={y} stroke="rgba(44,44,38,0.09)" strokeWidth="1" />
                <text x={Math.max(10, chartLeft - 128)} y={y + rowHeight * 0.45} className="font-serif" fontSize="24" fill="#2C2C26">{year}</text>
                <text x={Math.max(10, chartLeft - 128)} y={y + rowHeight * 0.45 + 18} className="font-mono" fontSize="10" fill="rgba(44,44,38,0.52)">1月-12月</text>
              </g>
            );
          })}
          <line x1={chartLeft - 100} x2={svgWidth - chartRight} y1={CHART_TOP + chartHeight} y2={CHART_TOP + chartHeight} stroke="rgba(44,44,38,0.09)" strokeWidth="1" />

          {categoryGroups.map((items, groupIndex) => (
            <g key={`genre-flow-${groupIndex}`}>
              {items.slice(0, -1).map((item, index) => {
                const next = items[index + 1];
                return (
                  <path
                    key={`${item.nb.bookId}-${next.nb.bookId}-genre`}
                    d={buildCurve(item.x, item.y, next.x, next.y, 0.42)}
                    fill="none"
                    stroke="rgba(44,44,38,0.075)"
                    strokeWidth="1"
                    strokeDasharray="2 6"
                  />
                );
              })}
            </g>
          ))}

          {parsed.slice(0, -1).map((item, index) => {
            const next = parsed[index + 1];
            return (
              <path
                key={`${item.nb.bookId}-${next.nb.bookId}-time`}
                d={buildCurve(item.x, item.y, next.x, next.y, 0.46)}
                fill="none"
                stroke="rgba(44,44,38,0.32)"
                strokeWidth="1.25"
                strokeLinecap="round"
                markerEnd={index % 4 === 0 ? "url(#journey-arrow)" : undefined}
              />
            );
          })}

          {parsed.length === 0 ? (
            <g>
              <rect x={chartLeft + 200} y={CHART_TOP + 110} width={900} height={80} rx={8} fill="rgba(255,255,255,0.4)" stroke="rgba(44,44,38,0.15)" strokeDasharray="4 4" />
              <text x={chartLeft + 650} y={CHART_TOP + 140} textAnchor="middle" className="font-serif" fontSize="20" fill="#2C2C26">等待阅读数据进入地图</text>
              <text x={chartLeft + 650} y={CHART_TOP + 165} textAnchor="middle" className="font-sans" fontSize="12" fill="rgba(44,44,38,0.6)">导入 Obsidian 或同步微信读书后，这里会自动生成年份与分类交叉的阅读轨迹。</text>
            </g>
          ) : (
            parsed.map((item) => {
              const category = CATEGORY_COLUMNS[item.categoryIndex];
              const borderWidth = Math.min(4, 1 + Math.log2(item.highlightCount + 1));
              const isKeyBook = item.highlightCount >= 8 || item.radius >= 16;
              const isHovered = hoveredBook?.nb.bookId === item.nb.bookId;
              return (
                <g
                  key={item.nb.bookId}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(event) => setHoveredBook({ ...item, mouseX: event.clientX, mouseY: event.clientY })}
                  onMouseMove={(event) => setHoveredBook((current) => (
                    current?.nb.bookId === item.nb.bookId
                      ? { ...current, mouseX: event.clientX, mouseY: event.clientY }
                      : current
                  ))}
                  onMouseLeave={() => setHoveredBook(null)}
                >
                  <circle
                    cx={item.x}
                    cy={item.y}
                    r={item.radius}
                    fill={category.fill}
                    stroke="rgba(44,44,38,0.26)"
                    strokeWidth={borderWidth}
                    opacity={isHovered ? 0.96 : 0.68}
                  />
                  {isKeyBook && (
                    <circle
                      cx={item.x}
                      cy={item.y}
                      r={item.radius + 7}
                      fill="none"
                      stroke="rgba(44,44,38,0.45)"
                      strokeWidth="1"
                    />
                  )}
                </g>
              );
            })
          )}

          <line x1={chartLeft - 100} x2={svgWidth - chartRight} y1={CHART_TOP + chartHeight + 34} y2={CHART_TOP + chartHeight + 34} stroke="rgba(44,44,38,0.10)" strokeWidth="1" />
          <text x={chartLeft - 100} y={CHART_TOP + chartHeight + 52} className="font-mono" fontSize="9" fill="rgba(44,44,38,0.40)" letterSpacing="0.08em">节点大小：阅读时间与划线数量 · 黑色实线：阅读先后 · 浅色虚线：同分类轨迹</text>
          <text x={svgWidth - chartRight} y={CHART_TOP + chartHeight + 52} textAnchor="end" className="font-mono" fontSize="9" fill="rgba(44,44,38,0.40)" letterSpacing="0.08em">© WeChat Reading 阅读演化地图</text>
        </svg>

        {hoveredBook && (() => {
          const area = chartAreaRef.current;
          if (!area) return null;
          const rect = area.getBoundingClientRect();
          const localX = hoveredBook.mouseX - rect.left;
          const localY = hoveredBook.mouseY - rect.top;
          return (
          <div
            className="absolute z-30 w-[330px] rounded-lg border border-[#2C2C26]/15 bg-white/95 backdrop-blur-md p-3 shadow-2xs pointer-events-none"
            style={{
              left: Math.max(8, Math.min(localX + 18, rect.width - 350)),
              top: Math.max(8, Math.min(localY + 18, rect.height - 130)),
            }}
          >
            <div className="flex gap-3">
              <div className="w-16 h-22 flex-shrink-0 overflow-hidden rounded border border-[#2C2C26]/10 bg-[#FAF9F6]">
                <BookCover
                  url={hoveredBook.nb.book.cover}
                  title={hoveredBook.nb.book.title}
                  author={hoveredBook.nb.book.author}
                  className="w-full h-full"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-serif text-sm leading-tight text-[#2C2C26] line-clamp-2">
                  {cleanTitle(hoveredBook.nb.book.title)}
                </p>
                <p className="mt-1 font-mono text-[9px] text-[#2C2C26]/48 truncate">
                  {hoveredBook.nb.book.author?.replace(/\[.*?\]/g, "") || "佚名"} · {hoveredBook.categoryTitle}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] text-[#2C2C26]/68">
                  <span>阅读时间</span>
                  <span className="text-right font-mono">{hoveredBook.readingMinutes >= 60 ? `${(hoveredBook.readingMinutes / 60).toFixed(1)}h` : `${hoveredBook.readingMinutes}min`}</span>
                  <span>划线个数</span>
                  <span className="text-right font-mono">{hoveredBook.highlightCount}</span>
                  <span>阅读时间点</span>
                  <span className="text-right font-mono">{hoveredBook.estimated ? "约" : ""}{hoveredBook.year}.{String(hoveredBook.month + 1).padStart(2, "0")}</span>
                </div>
              </div>
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
