/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * ReadingTrends component implementing five distinct data visualizations:
 * 1. 阅读日历热力图 (Reading Calendar Heatmap)
 * 2. 阅读时间折线图 (Reading Time Line Chart)
 * 3. 阅读时段热力图 (Reading Hour Heatmap / Time of Day Heatmap)
 * 4. 书籍阅读时长排行 (Book Reading Duration Ranking)
 * 5. 类型占比图 (Genre/Category Proportion Chart)
 */

import { useState, useMemo } from "react";
import { WeReadNotebook, WeReadOverallStats } from "../types";
import { Calendar, TrendingUp, Clock, Award, PieChart, Download, Feather } from "lucide-react";
import BookCover from "./BookCover";
import { toPng } from "html-to-image";
import { getNotebookReadingTimestamp, isValidReadingTimestamp } from "../utils/wereadDates";

interface ReadingTrendsProps {
  notebooks: WeReadNotebook[];
  stats: WeReadOverallStats | null;
  highlights: any[];
  onReanalyze?: () => void;
  isAnalyzing?: boolean;
}

const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const LINE_COLORS = ["#2C2C26", "#047857", "#B45309", "#0369A1", "#7C3AED", "#BE123C", "#4D7C0F", "#6B7280"];
const CALENDAR_CELL = 11.5;
const CALENDAR_GAP = 4;

// Polar to Cartesian coordinate converter for SVG Donut/Pie Arc drawing
function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

// Generate the SVG path element d string for a circular arc slice
function describeArc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    "M", start.x, start.y,
    "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y
  ].join(" ");
}

function formatDateKey(d: Date) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  let pathStr = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpX1 = prev.x + 15;
    const cpX2 = curr.x - 15;
    pathStr += ` C ${cpX1} ${prev.y}, ${cpX2} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return pathStr;
}

export default function ReadingTrends({ notebooks, stats, highlights, onReanalyze, isAnalyzing }: ReadingTrendsProps) {
  // Navigation states / interactive tooltip states
  const [hoveredCalDay, setHoveredCalDay] = useState<{ date: string; count: number; bookInfo?: string } | null>(null);
  const [hoveredMonth, setHoveredMonth] = useState<{ year: number; monthStr: string; hours: number; notes: number; color: string } | null>(null);
  const [hoveredHourSlot, setHoveredHourSlot] = useState<{ label: string; hour: number; val: number; percentage: number } | null>(null);
  const [hoveredCategory, setHoveredCategory] = useState<{ name: string; count: number; readingTime: number; percentage: number } | null>(null);
  const [hoveredAuthor, setHoveredAuthor] = useState<{ name: string; count: number; books: string[] } | null>(null);
  const [hiddenLineYears, setHiddenLineYears] = useState<Set<number>>(() => new Set());

  const handleDownload = () => {
    const element = document.getElementById("reading-trends-container");
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
        link.download = `WeRead-阅读趋势数据面板.png`;
        link.href = dataUrl;
        link.click();
      })
      .catch((err) => {
        console.error("Failed to export reading trends image:", err);
      });
  };

  // Reference End Date represents simulated "today"
  const anchorDate = useMemo(() => {
    const times = [
      ...highlights.map((hl) => hl.createTime).filter((time) => isValidReadingTimestamp(time)),
      ...notebooks.map((nb) => getNotebookReadingTimestamp(nb)).filter((time): time is number => Boolean(time))
    ];
    if (times.length === 0) return new Date();
    return new Date(Math.max(...times) * 1000);
  }, [highlights, notebooks]);

  // Total reading time summary parsing
  const formattedOverallTime = useMemo(() => {
    let seconds = stats?.totalReadTime || 0;
    if (!seconds) return "未提供";
    if (seconds < 500000) seconds = seconds * 60;
    const hours = (seconds / 3600).toFixed(1);
    return `${hours} 小时`;
  }, [stats]);

  // ==========================================
  // 1. Reading Calendar Heatmap Data Parse
  // ==========================================
  const heatmapData = useMemo(() => {
    const activityMap: Record<string, { count: number; bookInfo: string[] }> = {};
    const activeYears = new Set<number>();

    const addActivity = (timestamp?: number, weight = 1, bookName?: string) => {
      if (!isValidReadingTimestamp(timestamp)) return;
      const d = new Date(timestamp * 1000);
      const dateKey = formatDateKey(d);
      activeYears.add(d.getFullYear());
      if (!activityMap[dateKey]) {
        activityMap[dateKey] = { count: 0, bookInfo: [] };
      }
      activityMap[dateKey].count += weight;
      if (bookName && !activityMap[dateKey].bookInfo.includes(bookName)) {
        activityMap[dateKey].bookInfo.push(bookName);
      }
    };

    // 1. Incorporate real user highlights
    highlights.forEach((hl) => {
      addActivity(hl.createTime, 1.5, hl.bookName);
    });

    // 2. Incorporate real user book progress updates
    notebooks.forEach((nb) => {
      const updateT = getNotebookReadingTimestamp(nb);
      addActivity(updateT, 3, nb.book.title);
    });

    if (activeYears.size === 0) {
      activeYears.add(anchorDate.getFullYear());
    }

    const minYear = Math.min(...activeYears);
    const maxYear = Math.max(...activeYears);

    return Array.from({ length: maxYear - minYear + 1 }, (_, idx) => maxYear - idx).map((year) => {
      const yearEnd = year === maxYear
        ? new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate())
        : new Date(year, 11, 31);
      const days: Array<{ dateStr: string; dateObj: Date; count: number; bookInfo: string }> = [];
      const cursor = new Date(year, 0, 1);

      while (cursor <= yearEnd) {
        const dateKey = formatDateKey(cursor);
        const count = activityMap[dateKey]?.count || 0;
        const bkNames = activityMap[dateKey]?.bookInfo || [];

        days.push({
          dateStr: dateKey,
          dateObj: new Date(cursor),
          count: Math.round(count * 10) / 10,
          bookInfo: bkNames.slice(0, 3).join("、")
        });

        cursor.setDate(cursor.getDate() + 1);
      }

      const columns: typeof days[] = [];
      let currentWeek: typeof days = [];
      const firstDayOfWeek = days[0]?.dateObj.getDay() || 0;
      for (let pad = 0; pad < firstDayOfWeek; pad++) {
        currentWeek.push({ dateStr: "", dateObj: new Date(0), count: -1, bookInfo: "" });
      }

      days.forEach((day) => {
        currentWeek.push(day);
        if (currentWeek.length === 7) {
          columns.push(currentWeek);
          currentWeek = [];
        }
      });

      if (currentWeek.length > 0) {
        while (currentWeek.length < 7) {
          currentWeek.push({ dateStr: "", dateObj: new Date(0), count: -1, bookInfo: "" });
        }
        columns.push(currentWeek);
      }

      const monthLabels = MONTH_LABELS.map((label, month) => {
        const firstOfMonth = new Date(year, month, 1);
        if (firstOfMonth > yearEnd) return null;
        const dayOffset = Math.floor((firstOfMonth.getTime() - new Date(year, 0, 1).getTime()) / 86400000);
        const weekIndex = Math.floor((firstDayOfWeek + dayOffset) / 7);
        return { label, left: weekIndex * (CALENDAR_CELL + CALENDAR_GAP) };
      }).filter(Boolean) as Array<{ label: string; left: number }>;

      const total = days.reduce((sum, day) => sum + Math.max(0, day.count), 0);
      return { year, total: Math.round(total * 10) / 10, columns, monthLabels };
    });
  }, [notebooks, highlights, anchorDate]);

  // Heatmap intensity classification styling helper
  const getHeatColor = (count: number) => {
    if (count < 0) return "bg-transparent pointer-events-none"; // Padding days
    if (count === 0) return "bg-[#2C2C26]/2 border border-[#2C2C26]/5"; // No reading
    if (count <= 2) return "bg-[#2C2C26]/12 hover:bg-[#2C2C26]/25 border border-transparent"; // Low
    if (count <= 4) return "bg-[#2C2C26]/30 hover:bg-[#2C2C26]/45 border border-transparent"; // Medium
    if (count <= 7) return "bg-[#2C2C26]/60 hover:bg-[#2C2C26]/75 border border-transparent"; // High
    return "bg-[#2C2C26] shadow-3xs border border-transparent"; // Insane streak
  };

  // ==========================================
  // 2. Reading Time Line Chart (Every Year as One Line)
  // ==========================================
  const lineChartData = useMemo(() => {
    const byYear = new Map<number, Array<{ month: number; monthStr: string; hours: number; notes: number }>>();
    const ensureYear = (year: number) => {
      if (!byYear.has(year)) {
        byYear.set(year, MONTH_LABELS.map((monthStr, month) => ({ month, monthStr, hours: 0, notes: 0 })));
      }
      return byYear.get(year)!;
    };

    const addActivity = (timestamp?: number, notes = 1) => {
      if (!isValidReadingTimestamp(timestamp)) return;
      const d = new Date(timestamp * 1000);
      const item = ensureYear(d.getFullYear())[d.getMonth()];
      item.notes += notes;
      item.hours += notes;
    };

    highlights.forEach((hl) => addActivity(hl.createTime, 1));
    notebooks.forEach((nb) => addActivity(getNotebookReadingTimestamp(nb), Math.max(1, nb.noteCount || 1)));

    if (byYear.size === 0) {
      ensureYear(anchorDate.getFullYear());
    }

    return Array.from(byYear.entries())
      .sort(([yearA], [yearB]) => yearB - yearA)
      .map(([year, months], index) => ({
        year,
        color: LINE_COLORS[index % LINE_COLORS.length],
        months
      }));
  }, [anchorDate, highlights, notebooks]);

  const toggleLineYear = (year: number) => {
    setHiddenLineYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  };

  const yearLineCoords = useMemo(() => {
    const chartLeft = 28;
    const chartWidth = 708;
    const height = 90;
    const visibleData = lineChartData.filter((item) => !hiddenLineYears.has(item.year));
    const maxVal = Math.max(...visibleData.flatMap((item) => item.months.map((month) => month.hours)), 1);

    return lineChartData.map((yearItem) => {
      const points = yearItem.months.map((month, i) => {
        const x = chartLeft + (i * chartWidth) / 11;
        const y = 105 - (month.hours * height) / maxVal;
        return { x, y, ...month };
      });
      return {
        ...yearItem,
        hidden: hiddenLineYears.has(yearItem.year),
        points,
        path: buildSmoothPath(points)
      };
    });
  }, [lineChartData, hiddenLineYears]);

  // ==========================================
  // 3. Reading Hour Heatmap (24 Hours)
  // ==========================================
  const hourData = useMemo(() => {
    // Standard hour slots from 0 to 23
    const hours = Array.from({ length: 24 }, (_, i) => i);
    
    // Count books by their reading update/finish hour across all years.
    const hourMap: Record<number, number> = {};
    let countedBooks = 0;
    notebooks.forEach((nb) => {
      const timestamp = getNotebookReadingTimestamp(nb);
      if (timestamp) {
        const hr = new Date(timestamp * 1000).getHours();
        hourMap[hr] = (hourMap[hr] || 0) + 1;
        countedBooks += 1;
      }
    });

    // Fallback for sources that only provide highlight timestamps.
    if (countedBooks === 0) {
      highlights.forEach((hl) => {
        if (isValidReadingTimestamp(hl.createTime)) {
          const hr = new Date(hl.createTime * 1000).getHours();
          hourMap[hr] = (hourMap[hr] || 0) + 1;
        }
      });
    }

    const totalCount = hours.reduce((sum, hour) => sum + (hourMap[hour] || 0), 0);
    return hours.map((hour) => {
      const val = hourMap[hour] || 0;
      return {
        hour,
        val,
        percentage: totalCount > 0 ? Math.round((val / totalCount) * 1000) / 10 : 0
      }
    });
  }, [highlights, notebooks]);

  // Get active color intensity for biological hours
  const getHourHeatColor = (percentage: number) => {
    if (percentage < 1.5) return "bg-[#2C2C26]/2"; // Dormant hour
    if (percentage < 3) return "bg-[#2C2C26]/12"; 
    if (percentage < 5) return "bg-[#2C2C26]/30"; 
    if (percentage < 7.5) return "bg-[#2C2C26]/60"; 
    return "bg-[#2C2C26] ring-1 ring-[#FAF9F6]/20"; // Hot peak hour
  };

  // Convert hour number to readable dual-digit block label
  const formatHourLabel = (h: number) => {
    const nextH = (h + 1) % 24;
    return `${String(h).padStart(2, "0")}:00 - ${String(nextH).padStart(2, "0")}:00`;
  };

  // ==========================================
  // 4. Book Reading Duration Ranking
  // ==========================================
  const rankedBooks = useMemo(() => {
    // Check if the overall stats contains detailed durational book items
    let items: Array<{ title: string; author: string; cover: string; noteCount: number; duration: number }> = [];

    if (stats?.readLongest && stats.readLongest.length > 0) {
      items = stats.readLongest.map((rl) => ({
        title: rl.book?.title || "探寻智慧之书",
        author: rl.book?.author || "佚名",
        cover: rl.book?.cover || "",
        noteCount: notebooks.find(n => n.bookId === rl.book?.bookId)?.noteCount || 0,
        duration: Math.round((rl.readTime / 3600) * 10) / 10 // Convert seconds to hours
      }));
    } else {
      // Fallback: take top 5 books sorted by sort key or noteCount
      const topTen = [...notebooks].sort((a, b) => b.noteCount - a.noteCount).slice(0, 10);
      items = topTen.map((nb) => {
        return {
          title: nb.book.title,
          author: nb.book.author,
          cover: nb.book.cover,
          noteCount: nb.noteCount,
          duration: 0
        };
      });
    }

    return items
      .sort((a, b) => (b.duration || b.noteCount) - (a.duration || a.noteCount))
      .slice(0, 10);
  }, [stats, notebooks]);

  // ==========================================
  // 5. Author Frequency Word Cloud
  // ==========================================
  const authorData = useMemo(() => {
    const byAuthor = new Map<string, { name: string; count: number; books: string[] }>();

    notebooks.forEach((nb) => {
      const rawAuthor = nb.book.author?.trim();
      const author = rawAuthor && rawAuthor !== "Unknown" ? rawAuthor : "佚名";
      const item = byAuthor.get(author) || { name: author, count: 0, books: [] };
      item.count += 1;
      if (nb.book.title && !item.books.includes(nb.book.title)) {
        item.books.push(nb.book.title);
      }
      byAuthor.set(author, item);
    });

    return Array.from(byAuthor.values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hans-CN"))
      .slice(0, 10);
  }, [notebooks]);

  const maxAuthorCount = useMemo(() => {
    return Math.max(...authorData.map((author) => author.count), 1);
  }, [authorData]);

  // ==========================================
  // 6. Genre/Category Proportion Chart
  // ==========================================
  const genreData = useMemo(() => {
    let list: Array<{ name: string; count: number; readingTime: number }> = [];

    // Parse stats preference or fallback to categorizing the active bookshelf
    if (stats?.preferCategory && stats.preferCategory.length > 0) {
      list = stats.preferCategory.map((pc) => ({
        name: pc.categoryTitle,
        count: pc.readingCount,
        readingTime: pc.readingTime
      }));
    } else {
      const domains: Record<string, { count: number; secs: number }> = {};
      notebooks.forEach((nb) => {
        const cat = nb.book.category || "文学";
        const matched = Object.keys(domains).find(d => cat.includes(d) || d.includes(cat)) || cat;
        if (!domains[matched]) domains[matched] = { count: 0, secs: 0 };
        domains[matched].count += 1;
        domains[matched].secs += Math.max(1, nb.noteCount || 1);
      });

      list = Object.entries(domains).map(([name, obj]) => ({
        name,
        count: obj.count,
        readingTime: obj.secs
      }));
    }

    // Sort descending by count/readingTime
    const totalTime = list.reduce((sum, item) => sum + item.readingTime, 0) || 1;
    let accumulatedAngle = 0;

    const formattedList = list.slice(0, 5).map((item) => {
      const percentage = Math.round((item.readingTime / totalTime) * 1000) / 10;
      const angleSize = (item.readingTime / totalTime) * 360;
      
      const startAngle = accumulatedAngle;
      const endAngle = accumulatedAngle + angleSize;
      accumulatedAngle = endAngle;

      return {
        ...item,
        percentage,
        startAngle,
        endAngle
      };
    });

    return formattedList;
  }, [stats, notebooks]);

  // Overall most popular domain label
  const peakGenreName = useMemo(() => {
    if (genreData.length === 0) return "文学经典";
    return genreData[0].name;
  }, [genreData]);

  return (
    <div 
      className="module-surface-shadow px-18 py-14 bg-[#FBFAF7] border border-[#2C2C26]/8 rounded-xl w-[1700px] font-sans text-[#2C2C26] select-none relative"
      id="reading-trends-container"
    >
      {/* Structural pins for visual symmetry */}
      <div className="absolute -top-1.5 left-1/4 flex gap-12 z-10">
        <div className="w-16 h-1 bg-[#2C2C26]/12 rounded-full"></div>
      </div>
      <div className="absolute -top-1.5 right-1/4 flex gap-12 z-10">
        <div className="w-16 h-1 bg-[#2C2C26]/12 rounded-full"></div>
      </div>

      {/* Header */}
      <div className="relative min-h-[180px] border-b border-[#2C2C26]/62">
        <div className="absolute left-0 top-0 flex items-center gap-2 font-sans text-sm font-semibold uppercase tracking-widest text-[#2C2C26]/72">
          <TrendingUp className="h-4 w-4" />
          Reading Almanac
        </div>
        <div className="absolute inset-x-0 top-7 text-center">
          <h2 className="font-serif text-[88px] font-normal leading-none tracking-normal text-[#2C2C26]">
            阅读趋势
          </h2>
          <p className="-mt-8 font-serif text-[76px] font-normal uppercase leading-none tracking-normal text-[#2C2C26]/34">
            TRENDS
          </p>
          <p className="mt-5 text-[12px] font-semibold text-[#2C2C26]/52 uppercase tracking-[0.42em] font-sans">
            Chronology, choropleth, duration, and genre topology
          </p>
        </div>
        
        {/* Dynamic overall dashboard stats badges */}
        <div className="absolute right-0 top-0 flex items-center gap-3 text-[10px] font-mono text-[#2C2C26]/75">
          <button
            onClick={handleDownload}
            className="download-btn flex items-center gap-2 px-4 py-2.5 bg-white/78 hover:bg-[#2C2C26]/5 border border-[#2C2C26]/20 hover:border-[#2C2C26]/40 rounded text-[11px] text-[#2C2C26] font-mono shadow-3xs cursor-pointer transition-all"
            title="保存为 PNG 图片到本地"
          >
            <Download className="w-4 h-4 text-[#2C2C26]/70" />
            <span>保存趋势图</span>
          </button>
        </div>
      </div>

      {/* ========================================================
          ROW 1: HEATGRID & GENRE PIE CHART
          ======================================================== */}
      <div className="grid grid-cols-12 gap-10 pt-12 mb-10">
        
        {/* BLOCK 1: Reading Calendar Heatmap - Github contribution style (col-span-8) */}
        <div className="module-card-shadow col-span-12 lg:col-span-8 bg-white border border-[#2C2C26]/10 rounded-xl p-5 flex flex-col justify-between relative">
          
          <div className="flex justify-between items-center border-b border-[#2C2C26]/5 pb-4 mb-8">
            <h3 className="flex items-center gap-3 font-serif text-2xl font-semibold leading-none text-[#2C2C26]">
              <Calendar className="h-5 w-5 flex-shrink-0 translate-y-[1px] text-[#2C2C26]/55" />
              阅读日历热力图
            </h3>
            <span className="text-[9px] font-mono text-slate-400">
              {heatmapData.length > 0 ? `${heatmapData[heatmapData.length - 1].year} - ${heatmapData[0].year} 全部记录` : "暂无记录"}
            </span>
          </div>

          <div className="overflow-x-hidden pr-1 space-y-5">
            {heatmapData.map((yearBlock) => (
              <div key={yearBlock.year} className="border-b border-[#2C2C26]/5 last:border-b-0 pb-4 last:pb-0">
                <div className="flex items-baseline gap-2 mb-2 font-mono">
                  <span className="text-[13px] text-[#2C2C26] font-semibold">{yearBlock.year}</span>
                  <span className="text-[10px] text-slate-400">{yearBlock.total} 阅读活动点</span>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex flex-col gap-[3.5px] text-[8px] font-mono text-slate-400 pt-[19px] pr-1 select-none text-right">
                    <span>周日</span>
                    <span className="opacity-0">周一</span>
                    <span>周二</span>
                    <span className="opacity-0">周三</span>
                    <span>周四</span>
                    <span className="opacity-0">周五</span>
                    <span>周六</span>
                  </div>

                  <div className="min-w-0 overflow-x-auto scrollbar-none pb-1">
                    <div
                      className="relative h-4 mb-1.5 select-none"
                      style={{ width: yearBlock.columns.length * (CALENDAR_CELL + CALENDAR_GAP) }}
                    >
                      {yearBlock.monthLabels.map((month) => (
                        <span
                          key={month.label}
                          className="absolute top-0 text-[8px] font-mono text-slate-400"
                          style={{ left: month.left }}
                        >
                          {month.label}
                        </span>
                      ))}
                    </div>

                    <div className="flex gap-[4px]">
                      {yearBlock.columns.map((week, wkIdx) => (
                        <div key={wkIdx} className="flex flex-col gap-[4px]">
                          {week.map((day, dIdx) => {
                            const isDummy = day.count < 0;
                            return (
                              <div
                                key={`${day.dateStr || "pad"}-${wkIdx}-${dIdx}`}
                                onMouseEnter={() => {
                                  if (!isDummy) {
                                    setHoveredCalDay({
                                      date: day.dateStr,
                                      count: day.count,
                                      bookInfo: day.bookInfo
                                    });
                                  }
                                }}
                                onMouseLeave={() => setHoveredCalDay(null)}
                                className={`w-[11.5px] h-[11.5px] rounded-[2px] transition-all duration-150 cursor-crosshair ${getHeatColor(day.count)}`}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Interactive Floating Tooltip inside the heatmap bounding area */}
          <div className="flex justify-between items-center mt-3 pt-3 border-t border-[#2C2C26]/5 text-[10px] font-mono">
            <div className="text-slate-400 flex items-center gap-1.5">
              <span>图例：</span>
              <div className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 bg-[#2C2C26]/2 border border-[#2C2C26]/5 rounded-sm" />
                <span className="w-2.5 h-2.5 bg-[#2C2C26]/12 rounded-sm" />
                <span className="w-2.5 h-2.5 bg-[#2C2C26]/30 rounded-sm" />
                <span className="w-2.5 h-2.5 bg-[#2C2C26]/60 rounded-sm" />
                <span className="w-2.5 h-2.5 bg-[#2C2C26] rounded-sm" />
                <span className="text-[8px] text-slate-400 ml-1">高频</span>
              </div>
            </div>

            <div className="text-right h-4 flex items-center min-w-[280px] justify-end">
              {hoveredCalDay ? (
                <span className="text-[#2C2C26] text-[10px] bg-[#2C2C26]/4 border border-[#2C2C26]/10 px-2 py-0.5 rounded animate-fade-in">
                  📅 <strong className="font-medium text-amber-900">{hoveredCalDay.date}</strong> — 
                  阅读强度 <strong className="font-bold underline">{hoveredCalDay.count}级</strong> 
                  {hoveredCalDay.count > 0 && hoveredCalDay.bookInfo && ` (记录：《${hoveredCalDay.bookInfo}》)`}
                </span>
              ) : (
                <span className="text-slate-400 text-[9px] italic">将光标移至网格查看具体那一天的阅读轨迹</span>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT STACK: Genre/Category Donut Chart + Author Word Cloud */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-10">
          <div className="module-card-shadow bg-white border border-[#2C2C26]/10 rounded-xl p-5 flex flex-col justify-between relative">
            
            <div className="flex justify-between items-center border-b border-[#2C2C26]/5 pb-4 mb-8">
              <h3 className="flex items-center gap-3 font-serif text-2xl font-semibold leading-none text-[#2C2C26]">
                <PieChart className="h-5 w-5 flex-shrink-0 translate-y-[1px] text-[#2C2C26]/55" />
                阅读类型占比图
              </h3>
              <span className="text-[9px] font-mono text-slate-400">
                知识门类偏好
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 py-1">
              {/* Custom SVG Donut */}
              <div className="relative w-[150px] h-[150px] flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
                  {/* Default Background Gray circle */}
                  <circle cx="100" cy="100" r="70" fill="none" stroke="#FAF9F6" strokeWidth="20" />
                  
                  {/* Draw donut sectors */}
                  {genreData.map((item, idx) => {
                    const colors = [
                      "#2C2C26",       // literature (Solid ink)
                      "rgba(44, 44, 38, 0.75)",  // philosophy
                      "rgba(44, 44, 38, 0.55)",  // tech
                      "rgba(44, 44, 38, 0.35)",  // economics
                      "rgba(44, 44, 38, 0.18)",  // social
                    ];
                    return (
                      <path
                        key={item.name}
                        d={describeArc(100, 100, 70, item.startAngle, item.endAngle)}
                        fill="none"
                        stroke={colors[idx % colors.length]}
                        strokeWidth="19"
                        className="transition-all duration-300 hover:stroke-amber-800 cursor-pointer"
                        style={{ transformOrigin: "100px 100px" }}
                        onMouseEnter={() => setHoveredCategory({
                          name: item.name,
                          count: item.count,
                          readingTime: item.readingTime,
                          percentage: item.percentage
                        })}
                        onMouseLeave={() => setHoveredCategory(null)}
                      />
                    );
                  })}
                </svg>

                {/* Centered responsive legend text */}
                <div className="absolute flex flex-col items-center justify-center text-center select-none pointer-events-none">
                  {hoveredCategory ? (
                    <>
                      <span className="font-serif text-sm font-semibold text-amber-900 leading-none">
                        {hoveredCategory.name}
                      </span>
                      <span className="font-mono text-[10px] text-[#2C2C26]/70 mt-1 leading-none">
                        {hoveredCategory.percentage}%
                      </span>
                      <span className="font-sans text-[8px] text-slate-400 mt-0.5 leading-none">
                        {hoveredCategory.count} 本书
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-serif text-[11px] text-slate-400 leading-none">五大门类</span>
                      <span className="font-sans text-sm font-semibold text-[#2C2C26] mt-1.5 leading-none">
                        均衡发展
                      </span>
                      <span className="text-[7px] font-mono text-slate-400 uppercase tracking-wider mt-1 scale-90">
                        Hover arc to see info
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* List Legends */}
              <div className="flex-1 flex flex-col gap-2 pl-3 font-sans text-[10px]">
                {genreData.map((item, idx) => {
                  const bulletColors = [
                    "bg-[#2C2C26]",
                    "bg-[#2C2C26]/75 border border-[#2C2C26]/10",
                    "bg-[#2C2C26]/55 border border-[#2C2C26]/10",
                    "bg-[#2C2C26]/35 border border-[#2C2C26]/5",
                    "bg-[#2C2C26]/18 border border-[#2C2C26]/5",
                  ];
                  return (
                    <div 
                      key={item.name} 
                      className={`flex items-center justify-between p-1 rounded transition-colors ${
                        hoveredCategory?.name === item.name ? "bg-[#2C2C26]/5" : ""
                      }`}
                      onMouseEnter={() => setHoveredCategory({
                        name: item.name,
                        count: item.count,
                        readingTime: item.readingTime,
                        percentage: item.percentage
                      })}
                      onMouseLeave={() => setHoveredCategory(null)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${bulletColors[idx % bulletColors.length]}`} />
                        <span className="font-medium text-[#2C2C26]/95">{item.name}</span>
                      </div>
                      <span className="font-mono text-slate-400 text-[9px]">{item.percentage}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="module-card-shadow bg-white border border-[#2C2C26]/10 rounded-xl p-5 flex flex-col justify-between relative min-h-[220px]">
            <div className="flex justify-between items-center border-b border-[#2C2C26]/5 pb-4 mb-8">
              <h3 className="flex items-center gap-3 font-serif text-2xl font-semibold leading-none text-[#2C2C26]">
                <Feather className="h-5 w-5 flex-shrink-0 translate-y-[1px] text-[#2C2C26]/55" />
                作者统计
              </h3>
              <span className="text-[9px] font-mono text-slate-400">
                Top 10 作者
              </span>
            </div>

            <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-2 py-1">
              {authorData.length > 0 ? authorData.map((author, idx) => {
                const ratio = author.count / maxAuthorCount;
                const fontSize = 10 + ratio * 4;
                return (
                  <button
                    key={author.name}
                    type="button"
                    className={`group min-w-0 h-[42px] text-left rounded-md border px-2 py-1.5 transition-colors duration-150 cursor-crosshair ${
                      hoveredAuthor?.name === author.name
                        ? "bg-amber-50/70 border-amber-800/20"
                        : "bg-[#2C2C26]/2 border-[#2C2C26]/6 hover:bg-[#2C2C26]/4 hover:border-[#2C2C26]/12"
                    }`}
                    onMouseEnter={() => setHoveredAuthor(author)}
                    onMouseLeave={() => setHoveredAuthor(null)}
                    title={`${author.name}：${author.books.join("、")}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 flex items-baseline gap-1.5">
                        <span className="font-mono text-[8px] text-slate-400 w-4 flex-shrink-0">#{idx + 1}</span>
                        <span
                          className={`font-serif truncate ${
                            hoveredAuthor?.name === author.name ? "text-amber-900" : "text-[#2C2C26]"
                          }`}
                          style={{ fontSize, fontWeight: idx < 3 ? 600 : 500 }}
                        >
                          {author.name}
                        </span>
                      </span>
                      <span className="font-mono text-[8px] text-[#2C2C26]/55 flex-shrink-0">{author.count}本</span>
                    </div>
                    <div className="mt-1 h-1 bg-[#2C2C26]/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          idx < 3 ? "bg-[#2C2C26]/75" : "bg-[#2C2C26]/35"
                        }`}
                        style={{ width: `${Math.max(12, Math.round(ratio * 100))}%` }}
                      />
                    </div>
                  </button>
                );
              }) : (
                <span className="text-[10px] text-slate-400 font-mono">暂无作者数据</span>
              )}
            </div>

            <div className="border-t border-[#2C2C26]/5 pt-2.5 mt-2 text-[10px] font-mono h-10 flex items-center text-slate-400 overflow-hidden">
              {hoveredAuthor ? (
                <span className="block w-full truncate text-[#2C2C26] bg-[#2C2C26]/4 border border-[#2C2C26]/10 px-2 py-1 rounded leading-relaxed">
                  <strong className="text-amber-900">{hoveredAuthor.name}</strong>：{hoveredAuthor.count} 本，{hoveredAuthor.books.slice(0, 4).map((book) => `《${book}》`).join("、")}
                  {hoveredAuthor.books.length > 4 ? ` 等 ${hoveredAuthor.books.length} 本` : ""}
                </span>
              ) : (
                <span className="italic text-[9px]">将光标移至作者名查看读过的书</span>
              )}
            </div>
          </div>

          <div className="module-card-shadow bg-white border border-[#2C2C26]/10 rounded-xl p-5 flex flex-col justify-between relative">
            <div className="flex justify-between items-center border-b border-[#2C2C26]/5 pb-4 mb-8">
              <h3 className="flex items-center gap-3 font-serif text-2xl font-semibold leading-none text-[#2C2C26]">
                <Award className="h-5 w-5 flex-shrink-0 translate-y-[1px] text-[#2C2C26]/55" />
                阅读/划线记录排行
              </h3>
              <span className="text-[9px] font-mono text-slate-400">
                Top 10
              </span>
            </div>

            <div className="flex flex-col gap-2 py-1 flex-1 justify-center">
              {rankedBooks.map((item, idx) => {
                const maxVal = rankedBooks[0] ? (rankedBooks[0].duration || rankedBooks[0].noteCount || 1) : 1;
                const itemVal = item.duration || item.noteCount || 0;
                const barPercent = Math.max(15, Math.round((itemVal / maxVal) * 100));

                return (
                  <div key={idx} className="flex items-center gap-2 font-sans text-xs">
                    <div className="w-4 text-center font-serif font-semibold text-amber-900 text-[10px]">
                      {idx + 1}
                    </div>

                    <div className="w-5 h-7 flex-shrink-0 shadow-3xs">
                      <BookCover
                        url={item.cover}
                        title={item.title}
                        className="w-full h-full rounded-[2px]"
                      />
                    </div>

                    <div className="flex-1 flex flex-col">
                      <div className="flex justify-between items-center gap-1 mb-0.5">
                        <span className="font-medium text-[#2C2C26] truncate max-w-[120px] text-[11px]" title={item.title}>
                          {item.title}
                        </span>
                        <span className="font-mono text-[8px] text-[#2C2C26]/70 pr-1 flex-shrink-0">
                          {item.duration > 0 ? `${item.duration}h` : `${item.noteCount}条`}
                        </span>
                      </div>

                      <div className="w-full h-1 bg-[#2C2C26]/3 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 bg-[#2C2C26]/80`}
                          style={{ width: `${barPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================
          ROW 2: LINE CHART, HOURS HEATMAP
          ======================================================== */}
      <div className="grid grid-cols-12 gap-10">

        {/* BLOCK 3: Monthly Reading Time Line Chart (col-span-6) */}
        <div className="module-card-shadow col-span-12 lg:col-span-6 bg-white border border-[#2C2C26]/10 rounded-xl p-5 flex flex-col justify-between relative">
          
          <div className="flex justify-between items-center border-b border-[#2C2C26]/5 pb-4 mb-8">
            <h3 className="flex items-center gap-3 font-serif text-2xl font-semibold leading-none text-[#2C2C26]">
              <TrendingUp className="h-5 w-5 flex-shrink-0 translate-y-[1px] text-[#2C2C26]/55" />
              月度阅读活动折线图
            </h3>
            <span className="text-[9px] font-mono text-slate-400">
              每年一条线，可点击图例开关
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-2 min-h-[20px]">
            {yearLineCoords.map((yearItem) => (
              <button
                key={yearItem.year}
                type="button"
                onClick={() => toggleLineYear(yearItem.year)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[8px] font-mono transition-all cursor-pointer ${
                  yearItem.hidden
                    ? "border-[#2C2C26]/8 text-slate-300 bg-[#2C2C26]/2"
                    : "border-[#2C2C26]/12 text-[#2C2C26] bg-white hover:bg-[#2C2C26]/4"
                }`}
                title={`${yearItem.hidden ? "显示" : "隐藏"} ${yearItem.year} 年折线`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: yearItem.hidden ? "rgba(44,44,38,0.12)" : yearItem.color }}
                />
                {yearItem.year}
              </button>
            ))}
          </div>

          <div className="relative w-full h-[130px]">
            <svg className="w-full h-full" viewBox="0 0 760 120">
              {/* Y Axis Grid lines */}
              <line x1="28" y1="15" x2="736" y2="15" stroke="rgba(44,44,38,0.04)" strokeDasharray="3,3" />
              <line x1="28" y1="60" x2="736" y2="60" stroke="rgba(44,44,38,0.04)" strokeDasharray="3,3" />
              <line x1="28" y1="105" x2="736" y2="105" stroke="rgba(44,44,38,0.1)" />

              {/* Y Axis Labels */}
              <text x="18" y="18" textAnchor="end" className="text-[8px] font-mono fill-slate-300">高</text>
              <text x="18" y="63" textAnchor="end" className="text-[8px] font-mono fill-slate-300">中</text>
              <text x="18" y="108" textAnchor="end" className="text-[8px] font-mono fill-slate-300">0</text>

              {yearLineCoords.filter((yearItem) => !yearItem.hidden).map((yearItem) => (
                <g key={yearItem.year}>
                  <path
                    d={yearItem.path}
                    fill="none"
                    stroke={yearItem.color}
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    opacity={hoveredMonth && hoveredMonth.year !== yearItem.year ? 0.32 : 1}
                  />
                  {yearItem.points.map((pt) => (
                    <circle
                      key={`${yearItem.year}-${pt.month}`}
                      cx={pt.x}
                      cy={pt.y}
                      r={hoveredMonth?.year === yearItem.year && hoveredMonth.monthStr === pt.monthStr ? "5.5" : "3.2"}
                      fill="white"
                      stroke={yearItem.color}
                      strokeWidth="1.5"
                      className="transition-all duration-150 cursor-crosshair"
                      onMouseEnter={() => setHoveredMonth({
                        year: yearItem.year,
                        monthStr: pt.monthStr,
                        hours: pt.hours,
                        notes: pt.notes,
                        color: yearItem.color
                      })}
                      onMouseLeave={() => setHoveredMonth(null)}
                    />
                  ))}
                </g>
              ))}

              {/* X Axis Month Labels */}
              {(yearLineCoords[0]?.points || []).map((pt, index) => (
                <text
                  key={index}
                  x={pt.x}
                  y="118"
                  textAnchor="middle"
                  className={`text-[8px] font-mono ${
                    hoveredMonth?.monthStr === pt.monthStr ? "fill-[#2C2C26] font-semibold" : "fill-slate-400"
                  }`}
                >
                  {pt.monthStr}
                </text>
              ))}
            </svg>
          </div>

          <div className="border-t border-[#2C2C26]/5 pt-2.5 mt-2 text-[10px] font-mono h-5 flex items-center justify-between text-slate-400">
            {hoveredMonth ? (
              <span className="text-[#2C2C26] bg-[#2C2C26]/4 border border-[#2C2C26]/10 px-2 py-0.5 rounded animate-fade-in flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hoveredMonth.color }} />
                <strong>{hoveredMonth.year} {hoveredMonth.monthStr}</strong> 活动 <strong>{hoveredMonth.hours}点</strong>，留存笔记 <strong>{hoveredMonth.notes}条</strong>
              </span>
            ) : (
              <span className="italic text-[9px]">将光标停靠在节点查看对应年份与月份</span>
            )}
          </div>
        </div>

        {/* BLOCK 4: Reading Hour Heatmap - Hours of the day cycle (col-span-6) */}
        <div className="module-card-shadow col-span-12 lg:col-span-6 bg-white border border-[#2C2C26]/10 rounded-xl p-5 flex flex-col justify-between relative">
          
          <div className="flex justify-between items-center border-b border-[#2C2C26]/5 pb-4 mb-8">
            <h3 className="flex items-center gap-3 font-serif text-2xl font-semibold leading-none text-[#2C2C26]">
              <Clock className="h-5 w-5 flex-shrink-0 translate-y-[1px] text-[#2C2C26]/55" />
              阅读时段热力图
            </h3>
            <span className="text-[9px] font-mono text-slate-400">
              全部年份按书籍数聚合
            </span>
          </div>

          <div className="flex flex-col gap-2 mt-2">
            {/* Horizontal Chrono Row */}
            <div className="flex gap-[3.5px] items-center pt-2">
              {hourData.map((slot) => (
                <div
                  key={slot.hour}
                  className={`flex-1 h-[25px] rounded-[3px] transition-all cursor-crosshair ${getHourHeatColor(slot.percentage)}`}
                  onMouseEnter={() => setHoveredHourSlot({
                    label: formatHourLabel(slot.hour),
                    hour: slot.hour,
                    val: slot.val,
                    percentage: slot.percentage
                  })}
                  onMouseLeave={() => setHoveredHourSlot(null)}
                />
              ))}
            </div>

            {/* Scale hour labels */}
            <div className="flex justify-between text-[8px] font-mono text-slate-400 px-0.5 border-b border-[#2C2C26]/5 pb-2 select-none">
              <span>00:00</span>
              <span>04:00</span>
              <span>08:00</span>
              <span>12:00</span>
              <span>16:00</span>
              <span>20:00</span>
              <span>23:00</span>
            </div>
          </div>

          <div className="pt-2 mt-2 text-[10px] font-mono h-5 flex items-center justify-between text-slate-400">
            {hoveredHourSlot ? (
              <span className="text-[#2C2C26] bg-[#2C2C26]/4 border border-[#2C2C26]/10 px-2 py-0.5 rounded animate-fade-in">
                ⏱️ <strong>{hoveredHourSlot.label}</strong> — {hoveredHourSlot.val} 本，占全部书籍 <strong className="font-bold underline text-emerald-800">{hoveredHourSlot.percentage}%</strong>
              </span>
            ) : (
              <div className="flex gap-4 text-[9px] italic">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-[#2C2C26] rounded-xs" /> 高频时段
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-[#2C2C26]/12 rounded-xs" /> 低频时段
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer credits */}
      <div className="border-t border-[#2C2C26]/10 pt-4 mt-6 text-center text-[9px] text-[#2C2C26]/40 font-mono uppercase tracking-widest flex items-center justify-center gap-1">
        <span>© WECHAT READING TREND MAPS ANALYSIS</span>
      </div>
    </div>
  );
}
