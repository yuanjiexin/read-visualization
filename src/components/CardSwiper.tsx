/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import { WeReadHighlight, WeReadNotebook } from "../types";
import { Download, Heart, Compass, ArrowDown, ArrowUp, Check, Loader2 } from "lucide-react";
import { toPng } from "html-to-image";
import BookCover from "./BookCover";

interface CardSwiperProps {
  notebooks: WeReadNotebook[];
  highlights: Array<WeReadHighlight & { bookName: string; bookAuthor: string; bookCover: string }>;
}

export default function CardSwiper({ notebooks, highlights }: CardSwiperProps) {
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [likedCards, setLikedCards] = useState<Record<string, boolean>>({});
  const [heartsCount, setHeartsCount] = useState<Record<string, number>>({});
  const [floatingHearts, setFloatingHearts] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const [copyStatus, setCopyStatus] = useState<"idle" | "rendering" | "copied" | "downloaded" | "failed">("idle");
  const [safeBookCover, setSafeBookCover] = useState<string | null>(null);
  const [coverFetchFailed, setCoverFetchFailed] = useState<boolean>(false);
  const doubleTapRef = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const activeHighlight = highlights[currentIndex];

  // Fetch book cover securely as Base64 Data URL to guarantee HTML-To-Image doesn't fail due to CORS
  useEffect(() => {
    if (!activeHighlight || !activeHighlight.bookCover) {
      setSafeBookCover(null);
      setCoverFetchFailed(false);
      return;
    }

    setSafeBookCover(null);
    setCoverFetchFailed(false);

    let active = true;
    const proxiedUrl = `/api/weread/proxy-cover?url=${encodeURIComponent(activeHighlight.bookCover)}`;
    
    fetch(proxiedUrl)
      .then((res) => {
        if (!res.ok) throw new Error("Proxy fetch failed");
        return res.blob();
      })
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (active) {
            setSafeBookCover(reader.result as string);
          }
        };
        reader.readAsDataURL(blob);
      })
      .catch((err) => {
        console.warn("Could not retrieve book cover as Base64 via proxy:", err);
        if (active) {
          // If even proxy fails, we mark it, but we still display the image via standard tags
          setCoverFetchFailed(true);
        }
      });

    return () => {
      active = false;
    };
  }, [activeHighlight]);

  // Change card helper
  const navigateCard = (direction: "up" | "down") => {
    if (direction === "up") {
      setCurrentIndex((prev) => (prev > 0 ? prev - 1 : highlights.length - 1));
    } else if (direction === "down") {
      setCurrentIndex((prev) => (prev < highlights.length - 1 ? prev + 1 : 0));
    }
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

  return (
    <div 
      className="flex flex-col justify-between p-5 bg-white/80 backdrop-blur-md border border-[#2C2C26]/10 rounded-2xl shadow-xs w-full h-full font-sans text-[#2C2C26] select-none relative outline-hidden"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      id="card-swiper"
    >
      {/* Top Header info (Snug & Clean border spacing) */}
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
        className="flex-1 w-full bg-white border border-[#2C2C26]/10 rounded-lg shadow-3xs p-5 relative flex flex-col justify-between overflow-hidden cursor-pointer active:scale-[0.99] transition-transform duration-100 mb-4"
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

        {/* Book summary row details */}
        <div className="flex items-center gap-2.5 border-b border-[#2C2C26]/10 pb-3 mb-2 w-full">
          <div className="w-8 h-11 shadow-3xs flex-shrink-0">
            <BookCover 
              url={activeHighlight.bookCover} 
              title={activeHighlight.bookName} 
              author={activeHighlight.bookAuthor}
              overrideSrc={safeBookCover}
              className="w-full h-full"
            />
          </div>
          <div className="flex flex-col justify-center min-w-0 flex-1">
            <h4 className="font-sans font-medium text-[11px] text-[#2C2C26] leading-tight line-clamp-1">{activeHighlight.bookName}</h4>
            <p className="text-[9px] text-[#2C2C26]/60 font-mono mt-0.5 truncate">{activeHighlight.bookAuthor}</p>
          </div>
        </div>

        {/* Centered Large Quotes Quote Content */}
        <div className="flex-1 flex items-center justify-center px-1 py-4 min-h-0">
          <div className="relative w-full max-h-full overflow-y-auto scrollbar-thin">
            <span className="absolute -top-6 -left-3 text-[#2C2C26]/5 font-serif text-6xl leading-none select-none">"</span>
            <p className="font-serif italic text-sm md:text-base text-[#2C2C26] leading-relaxed text-justify relative z-10 px-1">
              {activeHighlight.markText}
            </p>
            <span className="absolute -bottom-8 -right-2 text-[#2C2C26]/5 font-serif text-6xl leading-none select-none">"</span>
          </div>
        </div>

        {/* Date line & Deep label */}
        <div className="flex items-center justify-between border-t border-[#2C2C26]/10 pt-3 text-[9px] font-mono text-[#2C2C26]/50 tracking-wide mt-2">
          <span>记录于 {new Date(activeHighlight.createTime * 1000).toISOString().split("T")[0]}</span>
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-0.5 text-rose-600/70 font-sans">
              ❤️ {currentLikes}
            </span>
            {activeHighlight.chapterUid && (
              <span>· 章节 : {activeHighlight.chapterUid}</span>
            )}
          </div>
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
  );
}
