/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";

interface BookCoverProps {
  url?: string;
  title: string;
  author?: string;
  className?: string;
  noteCount?: number;
  overrideSrc?: string | null;
}

export default function BookCover({ url, title, author = "佚名", className = "w-full h-full", noteCount, overrideSrc }: BookCoverProps) {
  const [imageError, setImageError] = useState(false);
  const [src, setSrc] = useState<string | null>(null);

  // Derive a solid, high-fidelity color profile deterministically based on book title
  const getDeterministicLayout = (name: string) => {
    const gradients = [
      "from-[#3E4A3D] to-[#252F24] text-[#E3EDE2]", // Muted Sage Green
      "from-[#8B4A3E] to-[#5C2B22] text-[#F9EBE8]", // Terracotta / Crimson rust
      "from-[#2D4256] to-[#172535] text-[#EAF2F8]", // Prussian Indigo
      "from-[#4F443E] to-[#2A221E] text-[#F3EFEF]", // Warm Clay
      "from-[#604E69] to-[#3B2E42] text-[#F5EEF6]", // Royal Violet
      "from-[#3F545B] to-[#213137] text-[#EAF0F2]", // Slate Teal
    ];
    const index = Math.abs(name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)) % gradients.length;
    return gradients[index];
  };

  useEffect(() => {
    setImageError(false);
    if (overrideSrc) {
      setSrc(overrideSrc);
    } else if (url) {
      // Use proxycover
      setSrc(`/api/weread/proxy-cover?url=${encodeURIComponent(url)}`);
    } else {
      setSrc(null);
    }
  }, [url, overrideSrc]);

  if ((!url && !overrideSrc) || imageError || !src) {
    // Elegant typographic fallback matching full-book binding aesthetics
    const themeGradient = getDeterministicLayout(title);
    return (
      <div 
        className={`relative ${className} bg-gradient-to-br ${themeGradient} flex flex-col justify-between p-2 shadow-sm select-none border border-[#2C2C26]/10 overflow-hidden group/fallback`}
        id={`fallback-cover-${title.replace(/\s+/g, "-")}`}
      >
        {/* Book spine simulation overlay */}
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-black/20 shadow-[1px_0_3px_rgba(0,0,0,0.3)]"></div>
        <div className="absolute left-1.5 top-0 bottom-0 w-[1px] bg-white/5"></div>

        {/* Top title */}
        <div className="pl-1 pt-1 flex-1 flex flex-col justify-start">
          <span className="font-serif font-bold text-[10px] md:text-xs leading-tight tracking-wide line-clamp-3">
            {title}
          </span>
        </div>

        {/* Bottom Metadata */}
        <div className="pl-1 text-right mt-1">
          <p className="text-[7px] md:text-[8px] font-mono opacity-80 truncate" title={author}>
            {author.replace(/\[.*?\]/, "").trim()}
          </p>
          {noteCount && noteCount > 0 ? (
            <span className="inline-block mt-0.5 text-[7px] bg-white/15 px-1 py-0.2 rounded font-mono">
              📝{noteCount}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className} overflow-hidden bg-gray-50 border border-[#2C2C26]/5 rounded-sm`}>
      <img
        src={src}
        alt={title}
        onError={() => setImageError(true)}
        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        referrerPolicy="no-referrer"
      />
      {noteCount && noteCount > 0 ? (
        <div className="absolute bottom-1 right-1 px-1 py-0.5 bg-[#2C2C26]/80 backdrop-blur-xs text-white text-[9px] font-mono rounded leading-none">
          📝 {noteCount}
        </div>
      ) : null}
    </div>
  );
}
