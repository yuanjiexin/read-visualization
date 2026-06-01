/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from "react";
import { WeReadHighlight, WeReadNotebook } from "../types";
import { Download, Heart, Compass, ArrowDown, ArrowUp, Check, Loader2 } from "lucide-react";
import { toPng } from "html-to-image";
import BookCover from "./BookCover";
import styleOneBg from "../../assets/风格一.png";
import styleTwoBg from "../../assets/风格二.png";
import styleThreeBg from "../../assets/风格三.png";
import styleFourBg from "../../assets/风格四.png";

interface CardSwiperProps {
  notebooks: WeReadNotebook[];
  highlights: Array<WeReadHighlight & { bookName: string; bookAuthor: string; bookCover: string }>;
}

type CardStyle = "terra" | "portable" | "receipt" | "cleanse";

const cardStyles: Array<{
  id: CardStyle;
  title: string;
}> = [
  { id: "terra", title: "样式 1" },
  { id: "portable", title: "样式 2" },
  { id: "receipt", title: "样式 3" },
  { id: "cleanse", title: "样式 4" },
];

const styleSlots: Array<{ id?: CardStyle; title: string }> = Array.from({ length: 6 }, (_, index) => ({
  id: cardStyles[index]?.id,
  title: cardStyles[index]?.title || `样式 ${index + 1}`,
}));

export default function CardSwiper({ notebooks, highlights }: CardSwiperProps) {
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [cardStyle, setCardStyle] = useState<CardStyle>("terra");
  const [likedCards, setLikedCards] = useState<Record<string, boolean>>({});
  const [heartsCount, setHeartsCount] = useState<Record<string, number>>({});
  const [floatingHearts, setFloatingHearts] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const [copyStatus, setCopyStatus] = useState<"idle" | "rendering" | "copied" | "downloaded" | "failed">("idle");
  const doubleTapRef = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const activeHighlight = highlights[currentIndex];

  // Change card helper
  const navigateCard = (direction: "up" | "down") => {
    if (direction === "up") {
      setCurrentIndex((prev) => (prev > 0 ? prev - 1 : highlights.length - 1));
    } else if (direction === "down") {
      setCurrentIndex((prev) => (prev < highlights.length - 1 ? prev + 1 : 0));
    }
    setCopyStatus("idle");
  };

  const changeCardStyle = (style: CardStyle) => {
    setCardStyle(style);
    setCopyStatus("idle");
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") navigateCard("up");
    else if (e.key === "ArrowDown") navigateCard("down");
  };

  // Click & Double-click mechanism for likes and floating hearts
  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    
    if (doubleTapRef.current && (now - doubleTapRef.current < DOUBLE_TAP_DELAY)) {
      // Double tap recognized!
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      triggerLike(x, y);
      doubleTapRef.current = null;
    } else {
      doubleTapRef.current = now;
    }
  };

  const triggerLike = (x: number, y: number) => {
    if (!activeHighlight) return;
    const bookmarkId = activeHighlight.bookmarkId;
    
    // Toggle liked state
    setLikedCards(prev => ({ ...prev, [bookmarkId]: true }));
    setHeartsCount(prev => ({ ...prev, [bookmarkId]: (prev[bookmarkId] || (Math.floor((activeHighlight.createTime % 1000) / 10) + 32)) + 1 }));

    // Spawn floating heart
    const newHeart = { id: Date.now(), x, y };
    setFloatingHearts(prev => [...prev, newHeart]);
    setTimeout(() => {
      setFloatingHearts(prev => prev.filter(h => h.id !== newHeart.id));
    }, 1000);
  };

  const handleDownloadImage = async () => {
    if (!activeHighlight || !cardRef.current || copyStatus === "rendering") return;

    setCopyStatus("rendering");

    try {
      // Configure html-to-image to build a high quality capture of the card
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        backgroundColor: "#ffffff",
        style: {
          transform: "scale(1)",
          borderRadius: "8px",
        },
        filter: (node) => {
          // Do not render any action buttons inside the picture if they exist
          if (node instanceof HTMLElement && (node.tagName === "BUTTON" || node.id === "copy-btn-inner")) {
            return false;
          }
          return true;
        }
      });

      if (!dataUrl) throw new Error("渲染图片失败");

      // Save/Download PNG file directly to be solid and reliable
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `微信读书-${activeHighlight.bookName.substring(0, 12)}-金句.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setCopyStatus("downloaded");
    } catch (error) {
      console.error("生成卡片图片并下载发生错误，采用文本备份复制:", error);
      
      // Fallback: Simple text clipboard copy
      try {
        await navigator.clipboard.writeText(`「${activeHighlight.markText}」 —— 来自《${activeHighlight.bookName}》`);
        setCopyStatus("copied");
      } catch (textFallbackErr) {
        setCopyStatus("failed");
      }
    }

    // Auto clear status
    setTimeout(() => {
      setCopyStatus("idle");
    }, 2500);
  };

  if (!activeHighlight) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full bg-[#fbf9f4] border border-[#d6cea8] rounded-xl p-6 text-center text-[#9a8d76]">
        <Compass className="w-8 h-8 animate-spin mb-4" />
        <p className="text-sm font-serif">正在读取微信读书划线数据...</p>
      </div>
    );
  }

  const currentLikes = heartsCount[activeHighlight.bookmarkId] || (Math.floor((activeHighlight.createTime % 1000) / 10) + 32);
  const recordedDate = new Date(activeHighlight.createTime * 1000).toISOString().split("T")[0];
  const cleanAuthor = activeHighlight.bookAuthor?.replace(/\[.*?\]/, "").trim() || "佚名";
  const styleFourQuoteClass = activeHighlight.markText.length > 220
    ? "text-[10px] leading-[1.62]"
    : activeHighlight.markText.length > 150
    ? "text-[11px] leading-[1.66]"
    : activeHighlight.markText.length > 90
    ? "text-[12.5px] leading-[1.72]"
    : "text-[14px] leading-[1.78]";

  const renderStyledCard = () => {
    if (cardStyle === "portable") {
      return (
        <div
          className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[#151515] text-[#1b1b1b]"
          style={{ fontFamily: "'Courier Prime', 'Courier New', 'Nimbus Mono PS', monospace" }}
        >
          <div className="relative aspect-[3/4] h-[108%] max-h-[108%] max-w-[108%]">
            <img
              src={styleTwoBg}
              alt=""
              className="absolute inset-0 h-full w-full object-contain"
              draggable={false}
            />
            <div className="absolute left-[35%] top-[35%] w-[39%] text-left">
              <p className="max-h-[148px] overflow-y-auto scrollbar-none text-[12.5px] font-light leading-[1.55] tracking-[0.08em] text-[#11110f]/85">
                “{activeHighlight.markText}”
              </p>
              <div className="mt-6 space-y-1 text-[9.5px] font-light leading-[1.4] tracking-[0.06em] text-[#5e5d58]/70">
                <p className="line-clamp-2">{activeHighlight.bookName}</p>
                <p>{cleanAuthor}</p>
                <p>{recordedDate}</p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (cardStyle === "receipt") {
      return (
        <div
          className="relative h-full w-full overflow-hidden bg-[#efece1] text-[#1c1614]"
          style={{ fontFamily: "'Fusion Pixel 12px Proportional SC', 'Courier New', monospace" }}
        >
          <img
            src={styleThreeBg}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
          <div className="absolute left-[18%] top-[7%] w-[64%] text-center text-[10px] font-normal tracking-[0.28em] text-[#1c1614]/78">
            READ.STUDIO
          </div>

          <div className="absolute left-[24%] top-[18%] flex h-[50%] w-[52%] flex-col items-center text-center text-[#1c1614]/82">
            <h3 className="line-clamp-2 text-[17px] font-normal uppercase leading-[1.35] tracking-[0.26em]">
              {activeHighlight.bookName}
            </h3>
            <div className="mt-7 h-px w-[86%] bg-[#1c1614]/70"></div>

            <div className="mt-12 min-h-0 flex-1 overflow-y-auto scrollbar-none text-[10px] font-normal leading-[1.6] tracking-[0.08em]">
              <p>{activeHighlight.markText}</p>
            </div>

            <div className="mt-9 h-px w-[86%] bg-[#1c1614]/70"></div>
            <div className="mt-7 text-[10px] font-normal leading-[1.65] tracking-[0.10em]">
              <p>{cleanAuthor}</p>
              <p>{recordedDate}</p>
            </div>
          </div>
        </div>
      );
    }

    if (cardStyle === "cleanse") {
      return (
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[#15130f] text-white">
          <div className="relative h-full w-full">
            <img
              src={styleFourBg}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
            <div className="absolute inset-0 bg-black/10"></div>

            <div className="absolute left-1/2 top-[17%] h-[clamp(138px,28%,188px)] w-[clamp(102px,38%,150px)] -translate-x-1/2 bg-[#f3f1ea] p-[3.2%] shadow-[0_12px_30px_rgba(0,0,0,0.22)] grayscale">
              <div className="absolute left-1/2 top-[-8%] z-20 h-[10%] w-[26%] -translate-x-1/2 rotate-[-2deg] bg-[#d6d2c8]/70 shadow-[0_1px_3px_rgba(50,45,36,0.10)]"></div>
              <div className="relative h-full w-full overflow-hidden bg-[#dfddd5]">
                <BookCover
                  url={activeHighlight.bookCover}
                  title={activeHighlight.bookName}
                  author={activeHighlight.bookAuthor}
                  className="h-full w-full rounded-none"
                />
                <div className="absolute inset-0 bg-[#f5f1e8]/22 mix-blend-screen"></div>
              </div>
            </div>

            <div
              className="absolute left-1/2 top-[50%] w-4/5 -translate-x-1/2 text-center font-light tracking-[0.03em] text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.35)]"
              style={{ fontFamily: "'Songti SC', 'STSong', SimSun, serif" }}
            >
              <p className={`mx-auto max-h-[220px] w-full overflow-y-auto scrollbar-none ${styleFourQuoteClass}`}>
                {activeHighlight.markText}
              </p>
              <div className="relative mx-auto mt-2 h-7 w-[72%]">
                <div className="absolute left-[8%] top-1 h-[1.5px] w-[80%] -rotate-3 bg-white/82"></div>
                <div className="absolute left-[22%] top-3.5 h-[1.5px] w-[58%] rotate-6 bg-white/58"></div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="relative h-full w-full overflow-hidden bg-[#2a211d] text-[#231d18] font-serif">
        <img
          src={styleOneBg}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
        <div className="relative flex h-full w-full items-center justify-center px-7 py-9">
          <div className="flex h-[76%] w-[68%] min-w-[246px] max-w-[360px] flex-col items-center justify-between bg-[#eee8d8] px-8 py-11 text-center shadow-[0_20px_38px_rgba(26,18,12,0.24)]">
            <div className="flex min-h-[64px] items-center justify-center">
              <h3 className="text-[18px] leading-[1.28] text-[#1f1915]/80">
                《{activeHighlight.bookName}》
              </h3>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center py-8">
              <p className="max-h-full overflow-y-auto scrollbar-none text-[15px] leading-[1.82] text-[#211b16]/80">
                {activeHighlight.markText}
              </p>
            </div>

            <div className="space-y-2 text-[14px] leading-[1.35] uppercase text-[#211b16]/80">
              <p>{cleanAuthor}</p>
              <p className="text-[12px]">{recordedDate}</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div 
      className="flex h-full w-full flex-col items-center justify-center gap-4 font-sans text-[#2C2C26] select-none outline-hidden"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      id="card-swiper"
    >
      <div className="flex w-full justify-center">
        <div className="flex items-center justify-center gap-3 rounded-full border border-[#2C2C26]/10 bg-white/80 px-3 py-1 shadow-xs backdrop-blur-md">
          {styleSlots.map(({ id, title }, index) => {
            const isActive = id === cardStyle;
            const isReady = Boolean(id);
            return (
              <button
                key={title}
                type="button"
                onClick={() => {
                  if (id) changeCardStyle(id);
                }}
                className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm font-sans font-normal transition-all duration-200 ${
                  isActive
                    ? "border-black bg-black text-white"
                    : isReady
                    ? "border-[#2C2C26]/8 bg-white/54 text-[#2C2C26]/55 hover:border-[#2C2C26]/18 hover:bg-white hover:text-[#2C2C26] cursor-pointer"
                    : "border-[#2C2C26]/6 bg-white/28 text-[#2C2C26]/22 cursor-default"
                }`}
                aria-label={title}
                aria-pressed={isActive}
                disabled={!isReady}
                title={title}
              >
                {index + 1}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 w-full max-w-[720px] flex-1 flex-col justify-between rounded-2xl border border-[#2C2C26]/10 bg-white/80 p-5 shadow-xs backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-[#2C2C26]/10 pb-2 mb-3">
          <span className="text-[10px] font-sans tracking-widest text-[#2C2C26]/50 uppercase">
            划线记忆 · 刷卡
          </span>
          <span className="text-[10px] font-mono text-[#2C2C26]/50">
            {currentIndex + 1} / {highlights.length}
          </span>
        </div>

      {/* Interactive Main Polaroid Card wrapper */}
      <div 
        ref={cardRef}
        onClick={handleCardClick}
        className="flex-1 w-full bg-white border border-[#2C2C26]/10 rounded-lg shadow-3xs relative flex flex-col justify-between overflow-hidden cursor-pointer active:scale-[0.99] transition-transform duration-100 mb-4"
        title="双击卡片可以点赞 resonance 哦"
      >
        {/* Floating hearts anchor */}
        {floatingHearts.map((h) => (
          <div
            key={h.id}
            className="absolute z-50 text-rose-500/80 pointer-events-none animate-float-heart"
            style={{ left: `${h.x}px`, top: `${h.y}px`, transform: "translate(-50%, -50%)" }}
          >
            <Heart className="w-12 h-12 fill-rose-500/75 text-rose-500" />
          </div>
        ))}

        {renderStyledCard()}

        <div className="absolute bottom-3 right-3 z-20 rounded-full bg-white/84 px-2.5 py-1 text-[9px] font-mono text-[#2C2C26]/60 shadow-[0_6px_16px_rgba(0,0,0,0.12)] backdrop-blur-sm">
          ♡ {currentLikes}
        </div>
      </div>

      {/* Swipe Navigators */}
      <div className="flex items-center justify-between pt-3 border-t border-[#2C2C26]/10">
        <button 
          onClick={() => navigateCard("up")}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-[#2C2C26]/5 text-[#2C2C26] border border-[#2C2C26]/10 rounded text-xs transition-colors cursor-pointer font-sans flex-shrink-0"
        >
          <ArrowUp className="w-3.5 h-3.5" />
          <span>上句</span>
        </button>

        {/* Repositioned Card Photo Saver Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDownloadImage();
          }}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs border active:scale-[0.97] transition-colors cursor-pointer font-sans font-medium ${
            copyStatus === "downloaded"
              ? "bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50/20"
              : copyStatus === "copied"
              ? "bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50/20"
              : copyStatus === "rendering"
              ? "bg-[#2C2C26]/5 border-[#2C2C26]/20 text-[#2C2C26]/60 cursor-not-allowed"
              : copyStatus === "failed"
              ? "bg-white border-rose-300 text-rose-700 hover:bg-rose-50/20"
              : "bg-white hover:bg-[#2C2C26]/5 text-[#2C2C26] border-[#2C2C26]/10"
          }`}
          disabled={copyStatus === "rendering"}
          title="生成并下载当前读书金句卡片图片"
          id="copy-btn-inner"
        >
          {copyStatus === "rendering" ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2C2C26]/60" />
              <span className="text-[11px]">绘制中...</span>
            </>
          ) : copyStatus === "downloaded" ? (
            <>
              <Check className="w-3.5 h-3.5 text-[#10B981]" />
              <span className="text-[11px] font-semibold text-[#047857]">下载成功</span>
            </>
          ) : copyStatus === "copied" ? (
            <>
              <Check className="w-3.5 h-3.5 text-[#10B981]" />
              <span className="text-[11px] font-semibold text-[#047857]">已存文本</span>
            </>
          ) : copyStatus === "failed" ? (
            <>
              <span className="text-[11px]">合并失败</span>
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5" />
              <span className="text-[11px]">下载卡片</span>
            </>
          )}
        </button>

        <button 
          onClick={() => navigateCard("down")}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-[#2C2C26]/5 text-[#2C2C26] border border-[#2C2C26]/10 rounded text-xs transition-colors cursor-pointer font-sans flex-shrink-0"
        >
          <span>下句</span>
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
      </div>
      </div>
    </div>
  );
}
