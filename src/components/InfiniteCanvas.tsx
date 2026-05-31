/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import { ZoomIn, ZoomOut, Maximize, Grip, Map, Move } from "lucide-react";
import { CanvasTransform } from "../types";

interface InfiniteCanvasProps {
  children: React.ReactNode;
  onBlankClick?: () => void;
}

const DEFAULT_TRANSFORM: CanvasTransform = {
  x: -31,
  y: 96,
  zoom: 0.55,
};

export default function InfiniteCanvas({ children, onBlankClick }: InfiniteCanvasProps) {
  const [transform, setTransform] = useState<CanvasTransform>(DEFAULT_TRANSFORM);
  const [isDragging, setIsDragging] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const transformStart = useRef({ x: 0, y: 0 });
  const transformRef = useRef(transform);
  const frameRef = useRef<number | null>(null);
  const movedDuringDrag = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const minimapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const applyTransform = (next: CanvasTransform, syncReactState = false) => {
    transformRef.current = next;
    if (contentRef.current) {
      contentRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.zoom})`;
    }
    if (syncReactState) {
      setTransform(next);
    }
  };

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  // Monitor transform changes to show minimap temporarily during interaction
  useEffect(() => {
    applyTransform(transform, false);
    setShowMinimap(true);
    if (minimapTimeoutRef.current) {
      clearTimeout(minimapTimeoutRef.current);
    }
    minimapTimeoutRef.current = setTimeout(() => {
      setShowMinimap(false);
    }, 1500);

    return () => {
      if (minimapTimeoutRef.current) {
        clearTimeout(minimapTimeoutRef.current);
      }
    };
  }, [transform]);

  // Keyboard and mouse coordinates tracking
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Check if we didn't click inside a button or form element inside kids
    const target = e.target as HTMLElement;
    if (
      target.closest("button") || 
      target.closest("input") || 
      target.closest("a") || 
      target.closest("#settings-panel")
    ) {
      return; 
    }

    setIsDragging(true);
    setShowMinimap(true);
    movedDuringDrag.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY };
    transformStart.current = { x: transformRef.current.x, y: transformRef.current.y };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      movedDuringDrag.current = true;
    }
    
    const nextTransform = {
      ...transformRef.current,
      x: transformStart.current.x + dx,
      y: transformStart.current.y + dy
    };

    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = requestAnimationFrame(() => {
      applyTransform(nextTransform, false);
      frameRef.current = null;
    });
  };

  const handleMouseUp = () => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setTransform(transformRef.current);
    setIsDragging(false);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      movedDuringDrag.current ||
      target.closest("[data-book-card='true']") ||
      target.closest("button") ||
      target.closest("input") ||
      target.closest("textarea") ||
      target.closest("select") ||
      target.closest("a") ||
      target.closest("#settings-panel") ||
      target.closest("#obsidian-importer-panel")
    ) {
      movedDuringDrag.current = false;
      return;
    }

    onBlankClick?.();
    movedDuringDrag.current = false;
  };

  // Touch triggers
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest("a")) return;

    const touch = e.touches[0];
    if (touch) {
      setIsDragging(true);
      setShowMinimap(true);
      dragStart.current = { x: touch.clientX, y: touch.clientY };
      transformStart.current = { x: transformRef.current.x, y: transformRef.current.y };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    if (touch) {
      const dx = touch.clientX - dragStart.current.x;
      const dy = touch.clientY - dragStart.current.y;
      const nextTransform = {
        ...transformRef.current,
        x: transformStart.current.x + dx,
        y: transformStart.current.y + dy
      };
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = requestAnimationFrame(() => {
        applyTransform(nextTransform, false);
        frameRef.current = null;
      });
    }
  };

  // Zoom helpers
  const handleZoom = (factor: number) => {
    const previous = transformRef.current;
    const newZoom = Math.max(0.2, Math.min(2.0, previous.zoom + factor));
    applyTransform({ ...previous, zoom: Number(newZoom.toFixed(2)) }, true);
  };

  const handleReset = () => {
    applyTransform(DEFAULT_TRANSFORM, true);
  };

  // Scroll zooming handler
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // Prevent default scroll if hovering canvas directly
    const target = e.target as HTMLElement;
    if (target.closest(".overflow-x-auto") || target.closest(".overflow-y-auto")) {
      return; 
    }
    
    e.preventDefault();
    const zoomDelta = e.deltaY < 0 ? 0.05 : -0.05;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      handleZoom(zoomDelta);
      return;
    }

    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    const previous = transformRef.current;
    const nextZoom = Number(Math.max(0.2, Math.min(2.0, previous.zoom + zoomDelta)).toFixed(2));
    const scaleRatio = nextZoom / previous.zoom;
    applyTransform({
      zoom: nextZoom,
      x: pointerX - (pointerX - previous.x) * scaleRatio,
      y: pointerY - (pointerY - previous.y) * scaleRatio,
    }, true);
  };

  return (
    <div 
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleMouseUp}
      onWheel={handleWheel}
      className={`absolute inset-0 select-none overflow-hidden bg-[#FAF9F6] cursor-grab active:cursor-grabbing ${
        isDragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      style={{
        backgroundImage: `
          linear-gradient(to right, rgba(44, 44, 38, 0.026) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(44, 44, 38, 0.026) 1px, transparent 1px)
        `,
        backgroundSize: "28px 28px",
      }}
    >
      {/* Top Banner Guidelines */}
      <div className="absolute top-4 left-6 z-10 pointer-events-none font-sans text-xs text-[#2C2C26]/60 select-none flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/70 backdrop-blur-md border border-[#2C2C26]/10 rounded shadow-3xs">
          <Move className="w-3.5 h-3.5" />
          <span>拖拽鼠标进行画布平移，滚轮或右下侧缩放</span>
        </div>
      </div>

      {/* The actual moving canvas sheet */}
      <div 
        ref={contentRef}
        className="absolute origin-top-left"
        style={{
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.zoom})`,
          width: "6200px",
          height: "6200px",
          willChange: "transform",
          contain: "layout style"
        }}
      >
        {children}
      </div>

      {/* Bottom Right Floating Controls */}
      <div className="absolute bottom-5 right-6 z-50 flex flex-col gap-4">
        {/* Floating Minimap */}
        <div className={`p-3 bg-white/90 backdrop-blur-md border border-[#2C2C26]/10 rounded-lg shadow-sm w-44 font-sans text-[#2C2C26] pointer-events-auto transition-all duration-300 transform ${
          showMinimap ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-2 scale-95 pointer-events-none"
        }`}>
          <div className="flex items-center gap-1 border-b border-[#2C2C26]/10 pb-1.5 mb-2 text-[10px] font-mono uppercase tracking-wider text-[#2C2C26]/50">
            <Map className="w-3.5 h-3.5" />
            <span>画布小地图</span>
          </div>
          {/* Miniature depiction of elements coordinate box */}
          <div className="h-24 bg-[#FAF9F6] rounded border border-[#2C2C26]/10 relative overflow-hidden">
            {/* Outline viewport display frame */}
            <div 
              className="absolute border-2 border-[#2C2C26] bg-[#2C2C26]/5 rounded-3xs pointer-events-none transition-all duration-300"
              style={{
                // Map coordinates scale to minimap proportions (e.g. 2200px width translates to 176px minimap width)
                // Minimap scaling factor is around 176/2200 = 0.08
                left: `${Math.max(0, Math.min(100, -transform.x / 12))}%`,
                top: `${Math.max(0, Math.min(80, -transform.y / 12))}%`,
                width: `${Math.max(15, Math.min(100, 100 / transform.zoom))}%`,
                height: `${Math.max(15, Math.min(84, 80 / transform.zoom))}%`,
              }}
            ></div>

            {/* Simulated blocks (four colored rectangles representing submaps styled at 2800px scale) */}
            {/* Block 1: Growth Map (wider, top row, takes ~35% of scaled height) */}
            <div className="absolute bg-[#2C2C26]/5 border border-[#2C2C26]/10 rounded-3xs" style={{ left: "10%", top: "6%", width: "80%", height: "36%" }}></div>
            {/* Block 2: Cognitive Landscape (middle-left, takes ~18% of scaled height) */}
            <div className="absolute bg-[#2C2C26]/10 border border-[#2C2C26]/15 rounded-3xs" style={{ left: "10%", top: "46%", width: "38%", height: "18%" }}></div>
            {/* Block 3: Relationship Map (middle-right, takes ~18% of scaled height) */}
            <div className="absolute bg-[#2C2C26]/15 border border-[#2C2C26]/20 rounded-3xs" style={{ left: "52%", top: "46%", width: "38%", height: "18%" }}></div>
            {/* Block 4: Reading Trends (wider, bottom row, takes ~24% of scaled height) */}
            <div className="absolute bg-[#2C2C26]/20 border border-[#2C2C26]/25 rounded-3xs" style={{ left: "10%", top: "68%", width: "80%", height: "24%" }}></div>
          </div>
        </div>

        {/* Zoom Controls block */}
        <div className="flex items-center gap-1 p-1 bg-white border border-[#2C2C26]/10 rounded-lg shadow-sm self-end">
          <button 
            onClick={() => handleZoom(0.05)}
            className="p-1 px-2.5 rounded hover:bg-[#2C2C26]/5 text-[#2C2C26] transition-colors border border-transparent hover:border-[#2C2C26]/10 active:scale-95 cursor-pointer flex items-center justify-center"
            title="放大"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          
          <span className="text-xs font-mono font-normal text-[#2C2C26]/70 w-12 text-center select-none">
            {Math.round(transform.zoom * 100)}%
          </span>

          <button 
            onClick={() => handleZoom(-0.05)}
            className="p-1 px-2.5 rounded hover:bg-[#2C2C26]/5 text-[#2C2C26] transition-colors border border-transparent hover:border-[#2C2C26]/10 active:scale-95 cursor-pointer flex items-center justify-center"
            title="缩小"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-[#2C2C26]/10 mx-1"></div>

          <button 
            onClick={handleReset}
            className="p-1 px-2.5 rounded hover:bg-[#2C2C26]/5 text-[#2C2C26] transition-colors border border-transparent hover:border-[#2C2C26]/10 active:scale-95 cursor-pointer flex items-center justify-center"
            title="自适应全局"
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
