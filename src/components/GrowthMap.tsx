/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import { WeReadNotebook } from "../types";
import { BookOpen, Calendar, Download, RefreshCw } from "lucide-react";
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

interface BookColorItemProps {
  key?: string;
  item: ParsedBookItem;
  selected: boolean;
  onSelectBook?: (bookId: string) => void;
  onDeleteBook?: (bookId: string) => void;
}

const fallbackPalette = [
  { overlay: "rgba(82, 130, 94, 0.82)", tag: "rgba(82, 130, 94, 0.74)" },
  { overlay: "rgba(105, 82, 160, 0.82)", tag: "rgba(105, 82, 160, 0.74)" },
  { overlay: "rgba(205, 93, 64, 0.84)", tag: "rgba(205, 93, 64, 0.76)" },
  { overlay: "rgba(45, 154, 150, 0.82)", tag: "rgba(45, 154, 150, 0.74)" },
  { overlay: "rgba(52, 104, 151, 0.82)", tag: "rgba(52, 104, 151, 0.74)" },
];

function getFallbackColor(title: string) {
  const index = Math.abs(title.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)) % fallbackPalette.length;
  return fallbackPalette[index];
}

function BookColorItem({ item, selected, onSelectBook, onDeleteBook }: BookColorItemProps) {
  const { nb, month, estimated } = item;
  const fallbackColor = useMemo(() => getFallbackColor(nb.book.title), [nb.book.title]);
  const [color, setColor] = useState(fallbackColor);

  useEffect(() => {
    let cancelled = false;
    if (!nb.book.cover) {
      setColor(fallbackColor);
      return;
    }

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = `/api/weread/proxy-cover?url=${encodeURIComponent(nb.book.cover)}`;
    image.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      const size = 24;
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, size, size);
      const data = context.getImageData(0, 0, size, size).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;

      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha < 80) continue;
        const pixelR = data[i];
        const pixelG = data[i + 1];
        const pixelB = data[i + 2];
        const isNearlyWhite = pixelR > 238 && pixelG > 238 && pixelB > 238;
        const isNearlyBlack = pixelR < 18 && pixelG < 18 && pixelB < 18;
        if (isNearlyWhite || isNearlyBlack) continue;
        r += pixelR;
        g += pixelG;
        b += pixelB;
        count += 1;
      }

      if (count > 0) {
        const avgR = Math.round(r / count);
        const avgG = Math.round(g / count);
        const avgB = Math.round(b / count);
        setColor({
          overlay: `rgba(${avgR}, ${avgG}, ${avgB}, 0.84)`,
          tag: `rgba(${avgR}, ${avgG}, ${avgB}, 0.76)`,
        });
      }
    };
    image.onerror = () => {
      if (!cancelled) setColor(fallbackColor);
    };

    return () => {
      cancelled = true;
    };
  }, [nb.book.cover, nb.book.title, fallbackColor]);

  return (
    <div 
      data-book-card="true"
      onClick={(event) => {
        event.stopPropagation();
        onSelectBook?.(nb.bookId);
      }}
      className={`group/book relative h-68 w-48 min-w-0 cursor-pointer overflow-hidden rounded-2xl bg-[#2C2C26] shadow-[0_18px_32px_rgba(44,44,38,0.18)] transition-all duration-300 hover:-translate-y-1 ${
        selected ? "ring-2 ring-red-500/55" : ""
      }`}
      title={`${nb.book.title}${selected ? " · 按 Delete 删除" : ""}`}
    >
      {selected && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDeleteBook?.(nb.bookId);
          }}
          className="absolute top-3 left-3 z-30 px-1.5 py-0.5 bg-red-600 hover:bg-red-700 text-white text-[8px] font-mono rounded shadow-3xs cursor-pointer"
          title="删除这本书"
        >
          DELETE
        </button>
      )}
      <div
        className="absolute right-3 top-3 z-30 rounded-full border border-white/30 px-2.5 py-1 text-[9px] font-mono font-semibold text-white shadow-[0_6px_14px_rgba(0,0,0,0.16)] backdrop-blur-md"
        style={{ backgroundColor: color.tag }}
      >
        {estimated ? "约 " : ""}{month + 1}月
      </div>
      <div className="absolute inset-0">
        <BookCover 
          url={nb.book.cover} 
          title={nb.book.title} 
          author={nb.book.author}
          className="w-full h-full"
        />
      </div>
      <div
        className="absolute inset-x-0 bottom-0 flex min-h-[46%] flex-col justify-end px-5 pb-5 pt-14 text-white"
        style={{
          background: `linear-gradient(180deg, rgba(44,44,38,0) 0%, ${color.overlay} 39%, ${color.overlay} 100%)`,
        }}
      >
        <div className="line-clamp-2 text-[17px] font-sans font-bold leading-tight drop-shadow-[0_1px_8px_rgba(0,0,0,0.28)]" title={nb.book.title}>
          {nb.book.title}
        </div>
        <div className="mt-2 truncate text-[11px] font-mono font-semibold text-white/82">
          {nb.book.author?.replace(/\[.*?\]/g, "") || "佚名"}
        </div>
      </div>
    </div>
  );
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
        link.download = `WeRead-阅读性格-${new Date().getFullYear()}.png`;
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
      className="module-surface-shadow w-[2300px] select-none relative overflow-hidden rounded-xl border border-[#2C2C26]/8 bg-white/52 px-18 py-14 font-sans text-[#2C2C26] backdrop-blur-md" 
      id="growth-map-container"
    >
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(90deg,rgba(44,44,38,0.018)_1px,transparent_1px),linear-gradient(180deg,rgba(44,44,38,0.016)_1px,transparent_1px)] bg-[size:58px_58px] opacity-45"></div>

      <div className="relative z-10">
        {/* Poster header */}
        <div className="relative min-h-[180px] border-b border-[#2C2C26]/62">
          <div className="absolute left-0 top-0 font-sans text-sm font-semibold uppercase tracking-widest text-[#2C2C26]/72">
            READS GROWTH GALLERY<span className="ml-1 inline-block h-2 w-2 bg-[#2C2C26]"></span>
          </div>
          <div className="absolute right-0 top-0 flex items-center gap-3">
            {onReanalyze && (
              <button
                onClick={onReanalyze}
                disabled={isAnalyzing}
                className="download-btn flex items-center gap-2 border border-[#2C2C26]/20 bg-white/78 px-4 py-2.5 text-[11px] text-[#2C2C26] font-mono shadow-3xs cursor-pointer transition-all hover:bg-[#2C2C26]/5 disabled:opacity-50"
                title="调用分析模型重新生成全部图谱内容"
              >
                <RefreshCw className={`w-4 h-4 text-[#2C2C26]/70 ${isAnalyzing ? "animate-spin" : ""}`} />
                <span>{isAnalyzing ? "分析中" : "重新分析"}</span>
              </button>
            )}
            <button
              onClick={handleDownload}
              className="download-btn flex items-center gap-2 border border-[#2C2C26]/20 bg-white/78 px-4 py-2.5 text-[11px] text-[#2C2C26] font-mono shadow-3xs cursor-pointer transition-all hover:bg-[#2C2C26]/5"
              title="保存为 PNG 图片到本地"
            >
              <Download className="w-4 h-4 text-[#2C2C26]/70" />
              <span>保存图谱</span>
            </button>
          </div>
          <div className="absolute inset-x-0 top-7 text-center">
            <div className="font-serif text-[88px] font-normal uppercase leading-none tracking-normal text-[#2C2C26]">
              阅读性格
            </div>
            <div className="-mt-8 font-serif text-[76px] font-normal uppercase leading-none tracking-normal text-[#2C2C26]/34">
              PERSONALITY
            </div>
            <p className="mt-5 font-sans text-[12px] font-semibold uppercase tracking-[0.42em] text-[#2C2C26]/52">
              Chronological growth of reads and spirit
            </p>
          </div>
        </div>

        {/* Exhibition rows */}
        <div className="pt-12">
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
              <section
                key={year}
                className="grid grid-cols-12 gap-16 border-b border-[#2C2C26]/62 py-18 animate-in fade-in slide-in-from-left-4 duration-300"
                style={{ animationDelay: `${idx * 150}ms` }}
              >
                <aside className="col-span-3 flex min-h-[360px] flex-col items-center justify-between text-center">
                  <div className="flex w-full max-w-[360px] flex-col items-center">
                    <div className="font-serif text-[64px] font-normal leading-none tracking-normal text-[#2C2C26]">
                      {year}
                    </div>
                    <div className="mt-9 flex items-center justify-center">
                      <BookOpen className="h-7 w-7 text-[#2C2C26]/80" />
                    </div>
                    <div className="mt-8 font-serif text-[38px] font-semibold leading-none text-[#2C2C26]">
                      {personality.title}
                    </div>
                    {personality.annualQuestion && (
                      <div className="mt-8 max-w-[320px] font-serif text-2xl leading-snug text-[#2C2C26]">
                        {personality.annualQuestion}
                      </div>
                    )}
                    <p className="mt-12 max-w-[320px] font-serif text-sm uppercase leading-6 text-[#2C2C26]/82">
                      {personality.description}
                    </p>
                  </div>
                  <div className="mt-12 w-full max-w-[320px] border-y border-[#2C2C26]/60 py-4 text-center font-sans text-xl font-semibold tracking-wide">
                    {yearBooks.length} Books
                  </div>
                </aside>

                <div className="col-span-9 flex flex-col justify-center">
                  <div className="mb-8 flex items-center gap-3 font-sans text-sm font-semibold uppercase tracking-[0.18em] text-[#2C2C26]/58">
                    <Calendar className="h-4 w-4" />
                    <span>{year} reading exhibition · latest month first</span>
                  </div>

                  {yearBooks.length === 0 ? (
                    <div className="flex h-72 items-center justify-center border border-dashed border-[#2C2C26]/30 bg-[#2C2C26]/4 text-sm text-[#2C2C26]/45">
                      暂无书籍记录
                    </div>
                  ) : (
                    <div className="grid grid-cols-7 items-start gap-4 overflow-visible">
                      {yearBooks.map((item) => (
                        <BookColorItem
                          key={item.nb.bookId}
                          item={item}
                          selected={selectedBookId === item.nb.bookId}
                          onSelectBook={onSelectBook}
                          onDeleteBook={onDeleteBook}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <div className="pt-8 text-center text-[10px] text-[#2C2C26]/50 font-mono uppercase tracking-widest">
          © WeChat Reading 心智地标与成长轴线
        </div>
      </div>
    </div>
  );
}
