/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from "react";
import { WeReadHighlight, WeReadNotebook } from "../types";
import { Layers, MapPin, Download } from "lucide-react";
import BookCover from "./BookCover";
import { toPng } from "html-to-image";

interface CognitiveLandscapeProps {
  notebooks: WeReadNotebook[];
  highlights?: Array<Pick<WeReadHighlight, "bookId">>;
  preferCategory: Array<{ categoryTitle: string; readingCount: number; val: number }>;
  onReanalyze?: () => void;
  isAnalyzing?: boolean;
}

type DepthBook = WeReadNotebook & {
  depthScore: number;
  completionScore: number;
  readingTimeScore: number;
  highlightCount: number;
  noteScore: number;
};

type HoveredDepthBook = DepthBook & {
  categoryTitle: string;
  x: number;
  y: number;
  popupX: number;
  popupY: number;
  popupWidth: number;
  popupHeight: number;
};

function getScaledLocalPoint(container: HTMLElement, clientX: number, clientY: number) {
  const rect = container.getBoundingClientRect();
  const scaleX = rect.width / container.offsetWidth || 1;
  const scaleY = rect.height / container.offsetHeight || 1;
  return {
    popupX: (clientX - rect.left) / scaleX,
    popupY: (clientY - rect.top) / scaleY,
    popupWidth: container.offsetWidth,
    popupHeight: container.offsetHeight,
  };
}

export default function CognitiveLandscape({ notebooks, highlights = [], onReanalyze, isAnalyzing }: CognitiveLandscapeProps) {
  const [hoveredBook, setHoveredBook] = useState<HoveredDepthBook | null>(null);

  const handleDownload = () => {
    const element = document.getElementById("cognitive-landscape-container");
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
        link.download = `WeRead-阅读深度图.png`;
        link.href = dataUrl;
        link.click();
      })
      .catch((err) => {
        console.error("Failed to export cognitive landscape image:", err);
      });
  };

  const CATEGORY_COLUMNS = [
    { label: "文学小说", keywords: ["文学", "小说", "经典", "诗", "散文", "随笔", "艺术", "传记", "fiction", "literature", "novel"] },
    { label: "哲学思想", keywords: ["哲学", "思想", "宗教", "存在", "自由", "意义", "伦理", "哲学宗教", "philosophy"] },
    { label: "心理学", keywords: ["心理", "精神", "梦", "人格", "自我", "认知", "习惯", "psychology"] },
    { label: "历史社会", keywords: ["历史", "社会", "政治", "文化", "人类", "传播", "媒介", "社会科学", "history", "society"] },
    { label: "科技未来", keywords: ["科技", "科学", "技术", "ai", "人工智能", "算法", "未来", "互联网", "代码", "science", "tech"] },
    { label: "经济商业", keywords: ["经济", "商业", "管理", "金融", "理财", "投资", "财富", "business", "economics"] },
    { label: "艺术设计", keywords: ["设计", "美学", "艺术", "建筑", "绘画", "摄影", "art", "design"] },
    { label: "其他", keywords: [] },
  ];

  const classifyCategory = (nb: WeReadNotebook): number => {
    const text = [
      nb.book.title,
      nb.book.author,
      nb.book.category,
      ...(nb.book.categories || []).map((c) => c.title),
    ].join(" ").toLowerCase();

    const foundIndex = CATEGORY_COLUMNS.findIndex((col) =>
      col.keywords.some((kw) => text.includes(kw.toLowerCase()))
    );
    return foundIndex >= 0 ? foundIndex : CATEGORY_COLUMNS.length - 1;
  };

  const categories = CATEGORY_COLUMNS.map(c => c.label);

  const highlightCountByBook = useMemo(() => highlights.reduce<Record<string, number>>((acc, item) => {
    acc[item.bookId] = (acc[item.bookId] || 0) + 1;
    return acc;
  }, {}), [highlights]);

  const getCompletionScore = (nb: WeReadNotebook): number => {
    if (typeof nb.readingProgress === "number") {
      const progress = nb.readingProgress <= 1 ? nb.readingProgress * 100 : nb.readingProgress;
      return Math.max(0, Math.min(100, Math.round(progress)));
    }
    return nb.markedStatus === 1 ? 100 : 0;
  };

  const getReadingTimeScore = (nb: WeReadNotebook): number => {
    const raw = nb as WeReadNotebook & { readTime?: number; readingTime?: number; totalReadingTime?: number };
    const timeInSeconds = raw.readTime || raw.readingTime || raw.totalReadingTime || 0;
    if (timeInSeconds > 0) {
      return Math.max(1, Math.round(timeInSeconds / 3600));
    }

    const completion = getCompletionScore(nb);
    const markVolume = (highlightCountByBook[nb.bookId] || nb.noteCount || 0) + (nb.reviewCount || 0);
    return Math.max(1, Math.round(completion / 12 + markVolume * 0.8));
  };

  const getDepthBook = (nb: WeReadNotebook): DepthBook => {
    const completionScore = getCompletionScore(nb);
    const readingTimeScore = getReadingTimeScore(nb);
    const highlightCount = highlightCountByBook[nb.bookId] || nb.noteCount || 0;
    const noteScore = nb.reviewCount || nb.bookmarkCount || 0;

    return {
      ...nb,
      completionScore,
      readingTimeScore,
      highlightCount,
      noteScore,
      depthScore: completionScore + readingTimeScore + highlightCount + noteScore,
    };
  };

  const getSpiralPoint = (index: number, total: number) => {
    if (total <= 1) return { x: 50, y: 50 };
    const progress = index / Math.max(1, total - 1);
    const angle = 0.55 + progress * Math.PI * 6.4;
    const radius = 5 + progress * 39;
    return {
      x: 50 + radius * Math.cos(angle),
      y: 50 + radius * Math.sin(angle),
    };
  };

  const buildConnectedCurvePath = (points: Array<{ x: number; y: number }>) => {
    if (points.length < 2) return "";
    const toSvg = (point: { x: number; y: number }) => ({ x: point.x * 2, y: point.y * 2 });
    const svgPoints = points.map(toSvg);

    return svgPoints.reduce((path, point, index) => {
      if (index === 0) return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;

      const previous = svgPoints[index - 1];
      const beforePrevious = svgPoints[index - 2] || previous;
      const next = svgPoints[index + 1] || point;
      const cp1 = {
        x: previous.x + (point.x - beforePrevious.x) / 6,
        y: previous.y + (point.y - beforePrevious.y) / 6,
      };
      const cp2 = {
        x: point.x - (next.x - previous.x) / 6,
        y: point.y - (next.y - previous.y) / 6,
      };

      return `${path} C ${cp1.x.toFixed(2)} ${cp1.y.toFixed(2)}, ${cp2.x.toFixed(2)} ${cp2.y.toFixed(2)}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    }, "");
  };

  const getDepthOpacity = (score: number, min: number, max: number) => {
    const ratio = max === min ? 1 : (score - min) / (max - min);
    return 0.28 + ratio * 0.72;
  };

  const booksByCategory = useMemo(() => {
    const groupedBooks: Record<string, DepthBook[]> = {};
    categories.forEach(cat => {
      groupedBooks[cat] = [];
    });

    notebooks.forEach(nb => {
      const catIndex = classifyCategory(nb);
      const catLabel = CATEGORY_COLUMNS[catIndex].label;
      groupedBooks[catLabel].push(getDepthBook(nb));
    });

    return groupedBooks;
  }, [notebooks, highlightCountByBook]);

  const visibleCategories = useMemo(
    () => categories.filter((cat) => (booksByCategory[cat] || []).length >= 3),
    [booksByCategory]
  );
  const categoryRows = useMemo(() => {
    const rows: string[][] = [];
    for (let index = 0; index < visibleCategories.length; index += 4) {
      rows.push(visibleCategories.slice(index, index + 4));
    }
    return rows;
  }, [visibleCategories]);

  return (
    <div 
      className="module-surface-shadow px-18 py-14 bg-[#FBFAF7] border border-[#2C2C26]/8 rounded-xl w-full min-h-[500px] font-sans text-[#2C2C26] select-none relative"
      id="cognitive-landscape-container"
    >
      {/* Header */}
      <div className="relative min-h-[180px] border-b border-[#2C2C26]/62">
        <div className="absolute left-0 top-0 flex items-center gap-2 font-sans text-sm font-semibold uppercase tracking-widest text-[#2C2C26]/72">
          <Layers className="h-4 w-4" />
          Depth Salon
        </div>
        <div className="absolute inset-x-0 top-7 text-center">
          <h2 className="font-serif text-[88px] font-normal leading-none tracking-normal text-[#2C2C26]">
            阅读深度
          </h2>
          <p className="-mt-8 font-serif text-[76px] font-normal uppercase leading-none tracking-normal text-[#2C2C26]/34">
            DEPTH
          </p>
          <p className="mt-5 text-[12px] font-semibold text-[#2C2C26]/52 uppercase tracking-[0.42em] font-sans">
            Cognitive topology and reading depth map
          </p>
        </div>
        <div className="absolute right-0 top-0 flex items-center gap-3">
          <button
            onClick={handleDownload}
            className="download-btn flex items-center gap-2 px-4 py-2.5 bg-white/78 hover:bg-[#2C2C26]/5 border border-[#2C2C26]/20 hover:border-[#2C2C26]/40 rounded text-[11px] text-[#2C2C26] font-mono shadow-3xs cursor-pointer transition-all animate-fade-in"
            title="保存为 PNG 图片到本地"
          >
            <Download className="w-4 h-4 text-[#2C2C26]/70" />
            <span>保存深度图</span>
          </button>
        </div>
      </div>

      {/* The Map Sheet (Thematic Islands in a grid) */}
      <div className="grid grid-cols-12 gap-10 pt-12 relative">
        {visibleCategories.length === 0 ? (
          <div className="col-span-12 min-h-[320px] border border-dashed border-[#2C2C26]/12 rounded-lg bg-white/50 flex flex-col items-center justify-center text-center px-8">
            <p className="font-serif text-lg text-[#2C2C26]">某类型下阅读书籍超过3本展示</p>
            <p className="mt-2 text-[10px] font-mono uppercase tracking-widest text-[#2C2C26]/45">
              READING DEPTH MAP REQUIRES 3+ BOOKS IN ONE CATEGORY
            </p>
          </div>
        ) : (
        <div className="col-span-12 flex flex-col gap-10">
          {categoryRows.map((row, rowIndex) => (
            <div
              key={`depth-row-${rowIndex}`}
              className="grid gap-10"
              style={{
                gridTemplateColumns: visibleCategories.length < 4
                  ? `repeat(${Math.max(1, row.length)}, minmax(0, 1fr))`
                  : "repeat(4, minmax(0, 1fr))"
              }}
            >
          {row.map((cat) => {
            const catBooks = [...(booksByCategory[cat] || [])].sort((a, b) => b.depthScore - a.depthScore);
            const spiralPoints = catBooks.map((nb, index) => ({
              nb,
              point: getSpiralPoint(index, catBooks.length),
            }));
            const depthRange = catBooks.reduce(
              (range, book) => ({
                min: Math.min(range.min, book.depthScore),
                max: Math.max(range.max, book.depthScore),
              }),
              { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
            );
            
            return (
              <div 
                key={cat} 
                className="module-card-shadow bg-white border border-[#2C2C26]/10 rounded-lg p-5 relative flex flex-col items-center justify-between overflow-hidden min-h-[560px]"
              >
                {/* Island background contours in SVG */}
                <div className="w-full max-w-[520px] aspect-square relative flex items-center justify-center p-1 border border-[#2C2C26]/5 rounded-full mt-2 bg-[#FAF9F6]/50">
                  <svg className="absolute inset-0 w-full h-full transform scale-95 pointer-events-none" viewBox="0 0 200 200">
                    {catBooks.length > 1 && (
                      <path
                        d={buildConnectedCurvePath(spiralPoints.map(({ point }) => point))}
                        fill="none"
                        stroke="rgba(44,44,38,0.38)"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                  </svg>

                  {/* Books follow an Archimedean spiral: the deepest books stay closest to the core. */}
                  {spiralPoints.map(({ nb, point }) => {
                    const { x, y } = point;
                    const opacity = getDepthOpacity(nb.depthScore, depthRange.min, depthRange.max);
                    const sizeClass = nb.depthScore === depthRange.max ? "w-4 h-4" : "w-3 h-3";
                    const isHovered = hoveredBook?.bookId === nb.bookId;

                    return (
                      <button
                        key={nb.bookId}
                        onMouseEnter={(event) => {
                          const container = event.currentTarget.parentElement;
                          if (!container) return;
                          setHoveredBook({ ...nb, categoryTitle: cat, x, y, ...getScaledLocalPoint(container, event.clientX, event.clientY) });
                        }}
                        onMouseMove={(event) => {
                          const container = event.currentTarget.parentElement;
                          if (!container) return;
                          setHoveredBook((current) => (
                            current?.bookId === nb.bookId
                              ? { ...current, ...getScaledLocalPoint(container, event.clientX, event.clientY) }
                              : current
                          ));
                        }}
                        onMouseLeave={() => setHoveredBook(null)}
                        onClick={(event) => {
                          const container = event.currentTarget.parentElement;
                          if (!container) return;
                          setHoveredBook({ ...nb, categoryTitle: cat, x, y, ...getScaledLocalPoint(container, event.clientX, event.clientY) });
                        }}
                        className={`absolute w-9 h-9 rounded-full cursor-pointer transition-all duration-300 flex items-center justify-center ${
                          isHovered
                            ? "z-30 ring-4 ring-[#2C2C26]/20"
                            : "z-20 hover:bg-[#2C2C26]"
                        }`}
                        style={{
                          left: `${x}%`,
                          top: `${y}%`,
                          transform: `translate(-50%, -50%) scale(${isHovered ? 1.28 : 1})`,
                        }}
                        title={`${nb.book.title} · 深度 ${nb.depthScore}`}
                      >
                        <span
                          className={`${sizeClass} rounded-full border border-white flex items-center justify-center shadow-3xs transition-all duration-300`}
                          style={{
                            backgroundColor: `rgba(44, 44, 38, ${isHovered ? 1 : opacity})`,
                          }}
                        >
                          <span className="w-1 h-1 rounded-full bg-white opacity-90"></span>
                        </span>
                      </button>
                    );
                  })}

                  {/* Center Peak label */}
                  <div className="absolute w-2 h-2 rounded-full bg-[#2C2C26] shadow-sm flex items-center justify-center">
                    <div className="w-0.5 h-0.5 bg-white rounded-full"></div>
                  </div>

                  {hoveredBook?.categoryTitle === cat && (
                    <div
                      className="absolute z-40 w-[330px] rounded-lg border border-[#2C2C26]/15 bg-white/95 backdrop-blur-md p-3 shadow-2xs pointer-events-none font-sans text-[#2C2C26]"
                      style={{
                        left: Math.max(8, Math.min(hoveredBook.popupX + 18, hoveredBook.popupWidth - 350)),
                        top: Math.max(8, Math.min(hoveredBook.popupY + 18, hoveredBook.popupHeight - 140)),
                      }}
                    >
                      <div className="flex gap-3">
                        <div className="w-16 h-22 flex-shrink-0 overflow-hidden rounded border border-[#2C2C26]/10 bg-[#FAF9F6]">
                          <BookCover
                            url={hoveredBook.book.cover}
                            title={hoveredBook.book.title}
                            author={hoveredBook.book.author}
                            noteCount={hoveredBook.noteCount}
                            className="w-full h-full"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-serif text-sm leading-tight text-[#2C2C26] line-clamp-2">
                            {hoveredBook.book.title}
                          </p>
                          <p className="mt-1 font-mono text-[9px] text-[#2C2C26]/48 truncate">
                            {hoveredBook.book.author?.replace(/\[.*?\]/g, "") || "佚名"} · {hoveredBook.categoryTitle}
                          </p>
                          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] text-[#2C2C26]/68">
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-[#2C2C26]/50" />
                              深度分数
                            </span>
                            <span className="text-right font-mono text-[#2C2C26]">{hoveredBook.depthScore}</span>
                            <span>完成度</span>
                            <span className="text-right font-mono">{hoveredBook.completionScore}</span>
                            <span>阅读时间</span>
                            <span className="text-right font-mono">{hoveredBook.readingTimeScore}h</span>
                            <span>划线 / 笔记</span>
                            <span className="text-right font-mono">{hoveredBook.highlightCount} / {hoveredBook.noteScore}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Island description */}
                <div className="text-center mt-8 z-10 font-sans">
                  <span className="font-serif text-[30px] font-semibold leading-none text-[#2C2C26] tracking-normal block">
                    {cat}
                  </span>
                  <span className="mt-4 block font-mono text-[12px] uppercase tracking-[0.32em] text-[#2C2C26]/42">
                    {catBooks.length} BOOKS · DEEPER TOWARD CORE
                  </span>
                </div>
              </div>
            );
          })}
            </div>
          ))}
        </div>
        )}

      </div>

      <div className="border-t border-[#2C2C26]/10 pt-4 mt-6 text-center text-[9px] text-[#2C2C26]/40 font-mono uppercase tracking-widest flex items-center justify-center gap-1">
        <span>DATA LOGIC · 阅读深度 = 阅读完成度百分值 + 阅读时间小时数 + 划线个数 + 笔记个数；每本书为一个点，由阿基米德螺旋串联，越靠近圆心深度越高、颜色越深。</span>
      </div>
    </div>
  );
}
