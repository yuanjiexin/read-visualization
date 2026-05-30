/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WeReadNotebook } from "../types";
import { BookOpen, Calendar, Milestone, Sparkles, Download, RefreshCw } from "lucide-react";
import BookCover from "./BookCover";
import { toPng } from "html-to-image";
import { getNotebookTimeInfo } from "../utils/wereadDates";

interface GrowthMapProps {
  notebooks: WeReadNotebook[];
  yearlyPersonality: Array<{
    year: number;
    title: string;
    annualQuestion?: string;
    visualArchetype?: string;
    artPersona?: string;
    personaReason?: string;
    description: string;
  }>;
  isAiGenerated: boolean;
  onReanalyze?: () => void;
  isAnalyzing?: boolean;
  selectedBookId?: string | null;
  onSelectBook?: (bookId: string) => void;
  onDeleteBook?: (bookId: string) => void;
}

interface ParsedBookItem {
  nb: WeReadNotebook;
  year: number;
  month: number;
  time: number;
  estimated: boolean;
}

export default function GrowthMap({ notebooks, yearlyPersonality, isAiGenerated, onReanalyze, isAnalyzing, selectedBookId, onSelectBook, onDeleteBook }: GrowthMapProps) {
  const handleDownload = () => {
    const element = document.getElementById("growth-map-container");
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
        link.download = `WeRead-成长图谱-${new Date().getFullYear()}.png`;
        link.href = dataUrl;
        link.click();
      })
      .catch((err) => {
        console.error("Failed to export growth map image:", err);
      });
  };

  const parsedBooks: ParsedBookItem[] = notebooks.map((nb, idx) => {
    const info = getNotebookTimeInfo(nb, idx);
    return {
      nb,
      year: info.year,
      month: info.month,
      time: info.time,
      estimated: info.estimated,
    };
  });

  const groupedBooks: Record<number, ParsedBookItem[]> = {};

  parsedBooks.forEach((item) => {
    if (!groupedBooks[item.year]) {
      groupedBooks[item.year] = [];
    }
    groupedBooks[item.year].push(item);
  });

  // Dynamically obtain all years that contain books, sorted descending
  const gatheredYears = Object.keys(groupedBooks).map(Number).sort((a, b) => b - a);
  const yearsOrdered = gatheredYears.length > 0 ? gatheredYears : [2026, 2025, 2024, 2023];

  // Sort each year's books descending by time (latest month first: December to January)
  yearsOrdered.forEach((year) => {
    if (groupedBooks[year]) {
      groupedBooks[year].sort((a, b) => b.time - a.time);
    }
  });

  return (
    <div 
      className="p-8 bg-white/40 backdrop-blur-md border border-[#2C2C26]/10 rounded-xl shadow-xs w-[1700px] font-sans text-[#2C2C26] select-none relative" 
      id="growth-map-container"
    >
      {/* Handcrafted pins at the top */}
      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 flex gap-12 z-10">
        <div className="w-16 h-1 bg-[#2C2C26]/10 rounded-full"></div>
      </div>

      {/* Title */}
      <div className="flex items-center justify-between border-b border-[#2C2C26]/10 pb-4 mb-8">
        <div>
          <h2 className="font-serif font-normal text-xl text-[#2C2C26] tracking-tight flex items-center gap-2">
            <Milestone className="w-5 h-5 text-[#2C2C26]/60" />
            成长图谱
          </h2>
          <p className="text-[9px] text-[#2C2C26]/50 mt-1 uppercase tracking-widest font-sans">CHRONOLOGICAL GROWTH OF READS & SPIRIT</p>
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

      {/* Timeline flow */}
      <div className="relative pl-12 space-y-12">
        {/* Solid vertical pencil line */}
        <div className="absolute left-[39px] top-4 bottom-4 w-[1px] bg-gradient-to-b from-[#2C2C26]/40 via-[#2C2C26]/20 to-[#2C2C26]/5"></div>

        {yearsOrdered.map((year, idx) => {
          const personality = isAiGenerated
            ? yearlyPersonality.find(yp => Number(yp.year) === year) || {
                year,
                title: "模型未生成",
                description: "当前模型已连接，但还没有返回该年度的阅读人格。请点击画布上的重试，重新生成本年度阅读人格。"
              }
            : {
                year,
                title: "模型未连接",
                description: "点击右上角连接分析模型，添加模型后可以生成本年度阅读人格。"
              };
          const yearBooks = groupedBooks[year] || [];

          return (
            <div key={year} className="relative group animate-in fade-in slide-in-from-left-4 duration-300" style={{ animationDelay: `${idx * 150}ms` }}>
              {/* Timeline circle node */}
              <div className="absolute -left-[24px] top-2 flex items-center justify-center">
                <div className="w-6 h-6 rounded-full bg-[#FAF9F6] border border-[#2C2C26]/70 flex items-center justify-center shadow-2xs">
                  <div className="w-2 h-2 rounded-full bg-[#2C2C26] group-hover:scale-125 transition-transform"></div>
                </div>
              </div>

              {/* Grid content: year, info details, book polaroids */}
              <div className="grid grid-cols-12 gap-8 pl-4">
                {/* Year and Personality text description */}
                <div className="col-span-4 min-h-[220px] bg-white border border-[#2C2C26]/15 rounded-lg p-6 shadow-2xs hover:border-[#2C2C26]/30 transition-all duration-300 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-serif font-normal text-2xl text-[#2C2C26] tracking-tight">{year}</span>
                      <span className="text-[9px] uppercase font-sans tracking-wider px-1.5 py-0.5 bg-[#2C2C26]/5 text-[#2C2C26]/60 rounded">
                        Theme
                      </span>
                    </div>
                    <h4 className="font-sans font-semibold text-sm text-[#2C2C26] mb-3 flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-[#2C2C26]/50" />
                      {personality.title}
                    </h4>
                    {personality.annualQuestion && (
                      <div className="text-[11px] font-serif text-[#2C2C26]/80 mb-3 border-l border-[#2C2C26]/20 pl-2">
                        {personality.annualQuestion}
                      </div>
                    )}
                    <p className="text-xs text-[#2C2C26]/72 leading-6 font-sans text-justify">
                      {personality.description}
                    </p>
                    {(personality.visualArchetype || personality.artPersona) && (
                      <div className="mt-4 pt-3 border-t border-[#2C2C26]/10">
                        <div className="flex items-center gap-1.5 text-[10px] font-sans text-[#2C2C26]/65 mb-1.5">
                          <Sparkles className="w-3 h-3" />
                          <span>阅读画像：{[personality.visualArchetype, personality.artPersona].filter(Boolean).join(" · ")}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Horizontal covers row (span 9 out of 12 for maximum horizontal expansion) */}
                <div className="col-span-8 flex flex-col justify-center">
                  <div className="text-[10px] font-sans text-[#2C2C26]/50 mb-2 flex items-center gap-1.5 leading-none">
                    <Calendar className="w-3 h-3" />
                     {year} 年度读书 {yearBooks.length} 本 · 横向月度递减排布 (最新在前)
                  </div>

                  {yearBooks.length === 0 ? (
                    <div className="flex items-center justify-center py-6 border border-dashed border-[#2C2C26]/10 rounded-lg bg-[#2C2C26]/2 text-xs text-[#2C2C26]/40">
                      暂无书籍记录
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-5 py-2 pr-4 overflow-visible">
                      {yearBooks.map((item, bIdx) => {
                        const { nb, month, estimated } = item;
                        return (
                          <div 
                            key={nb.bookId} 
                            data-book-card="true"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectBook?.(nb.bookId);
                            }}
                            className={`flex-shrink-0 group/book relative bg-white border p-2 pb-2.5 rounded shadow-3xs hover:scale-[1.01] transition-all duration-300 w-24 text-center cursor-pointer ${
                              selectedBookId === nb.bookId
                                ? "border-red-500 ring-2 ring-red-500/25 bg-red-50/30"
                                : "border-[#2C2C26]/10 hover:border-[#2C2C26]/30"
                            }`}
                            title={`${nb.book.title}${selectedBookId === nb.bookId ? " · 按 Delete 删除" : ""}`}
                          >
                            {selectedBookId === nb.bookId && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDeleteBook?.(nb.bookId);
                                }}
                                className="absolute -top-3 -right-3 z-30 px-1.5 py-0.5 bg-red-600 hover:bg-red-700 text-white text-[8px] font-mono rounded shadow-3xs cursor-pointer"
                                title="删除这本书"
                              >
                                DELETE
                              </button>
                            )}
                            {/* Short corner month tag */}
                            <div className="absolute top-1 left-1 z-15 px-1 py-0.5 bg-[#2C2C26] text-white text-[8px] font-sans font-medium rounded-xs leading-none scale-90 origin-top-left shadow-3xs">
                              {estimated ? "约" : ""}{month + 1}月
                            </div>

                            {/* Book cover image */}
                            <div className="w-full h-24 mb-2 mt-2">
                              <BookCover 
                                url={nb.book.cover} 
                                title={nb.book.title} 
                                author={nb.book.author}
                                className="w-full h-full"
                                noteCount={nb.noteCount}
                              />
                            </div>

                            {/* Short title */}
                            <div className="text-[10px] font-sans font-medium text-[#2C2C26] truncate px-0.5 leading-tight" title={nb.book.title}>
                              {nb.book.title}
                            </div>
                            {/* Author name */}
                            <div className="text-[8px] text-[#2C2C26]/50 truncate px-0.5 mt-0.5 font-mono">
                              {nb.book.author?.replace(/\[.*?\]/, "") || "佚名"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-[#2C2C26]/10 pt-4 mt-6 text-center text-[9px] text-[#2C2C26]/40 font-mono uppercase tracking-widest flex items-center justify-center gap-1">
        <span>© WeChat Reading 心智地标与成长轴线</span>
      </div>
    </div>
  );
}
