/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from "react";
import { Upload, FileText, CheckCircle2, RefreshCw, Layers, Trash2, HelpCircle } from "lucide-react";
import { WeReadNotebook } from "../types";

interface ObsidianImporterProps {
  onImportComplete: (data: { books: any[]; highlights: any[] }) => void;
  onClose?: () => void;
}

type ParsedBook = {
  title: string;
  author: string;
  cover: string;
  category?: string;
  lastReadDate?: number;
  sourceName: string;
  sourcePath: string;
  highlights: string[];
};

export default function ObsidianImporter({ onImportComplete, onClose }: ObsidianImporterProps) {
  const [dragActive, setDragActive] = useState(false);
  const [parsedBooks, setParsedBooks] = useState<ParsedBook[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importCount, setImportCount] = useState(0);

  const parseMarkdownContent = (filename: string, content: string, sourcePath = filename): ParsedBook | null => {
    const baseName = filename.replace(/\.(md|txt)$/i, "");
    if (/^(元数据|metadata|meta|index|readme|目录|说明)$/i.test(baseName.trim())) {
      return null;
    }

    let title = baseName;
    let author = "未知作者";
    let cover = "";
    let category = "";
    let rawDateStr = "";

    const stripValue = (value: string) => {
      return value
        .replace(/^["']|["']$/g, "")
        .replace(/^\[\[|\]\]$/g, "")
        .trim();
    };

    const findMetaValue = (text: string, keys: string[]) => {
      const keyPattern = keys.join("|");
      const patterns = [
        new RegExp(`^\\s*(?:${keyPattern})\\s*[:：]\\s*(.+)$`, "im"),
        new RegExp(`^\\s*[-*]\\s*(?:${keyPattern})\\s*[:：]\\s*(.+)$`, "im"),
        new RegExp(`^\\s*>?\\s*(?:${keyPattern})\\s*[:：]\\s*(.+)$`, "im"),
      ];
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return stripValue(match[1]);
      }
      return "";
    };

    const findYamlValue = (text: string, keys: string[]) => {
      const keyPattern = keys.join("|");
      const pattern = new RegExp(`^\\s*(?:${keyPattern})\\s*[:：]\\s*(.+)$`, "im");
      const match = text.match(pattern);
      return match?.[1] ? stripValue(match[1]) : "";
    };

    const normalizeDate = (input: string) => {
      if (!input) return undefined;
      const cleanDate = input.replace(/[\[\]"]/g, "").replace(/年|月/g, "-").replace(/日/g, "").trim();
      const parsedTime = Date.parse(cleanDate);
      if (!isNaN(parsedTime)) return Math.floor(parsedTime / 1000);
      const yearMatch = cleanDate.match(/\b(20\d{2})\b/);
      if (yearMatch) return Math.floor(new Date(parseInt(yearMatch[1], 10), 0, 1).getTime() / 1000);
      return undefined;
    };

    const cleanHighlightText = (text: string) => {
      return text
        .replace(/\s*\^[^\s]+$/g, "")
        .replace(/\s*(?:⏱️|⏰|🕒|🕓|🕘|🕙|🕚|🕛|🕐|🕑|🕔|🕕|🕖|🕗|clock:|time:|时间[:：]?|记录于[:：]?)\s*\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*$/i, "")
        .replace(/\s*\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*$/i, "")
        .replace(/^["“]|["”]$/g, "")
        .replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, "")
        .replace(/[\u{231A}-\u{231B}\u{23E9}-\u{23EC}\u{23F0}\u{23F3}\u{25FD}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2705}\u{2728}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2795}-\u{2797}\u{27B0}\u{27BF}]/gu, "")
        .trim();
    };

    // 1. Detect YAML Frontmatter
    const yamlMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (yamlMatch) {
      const yaml = yamlMatch[1];
      const yamlTitle = findYamlValue(yaml, ["title", "bookName", "book", "书籍名称", "书名", "name"]);
      if (yamlTitle && !/^(元数据|metadata|目录|说明)$/i.test(yamlTitle)) {
        title = yamlTitle;
      }
      author = findYamlValue(yaml, ["author", "bookAuthor", "作者", "creator"]) || author;
      cover = findYamlValue(yaml, ["cover", "封面", "bookCover", "image", "poster"]) || cover;
      category = findYamlValue(yaml, ["category", "categories", "tag", "tags", "genre", "genres", "类别", "标签", "分类"]) || category;
      rawDateStr = findYamlValue(yaml, ["lastreaddate", "lastReadDate", "last_read_date", "readDate", "read_date", "finishReading", "date", "阅读日期", "时间"]) || rawDateStr;
    }

    author = findMetaValue(content, ["author", "bookAuthor", "作者"]) || author;
    cover = findMetaValue(content, ["cover", "封面", "bookCover", "image", "poster"]) || cover;
    category = findMetaValue(content, ["category", "categories", "tags", "类别", "分类"]) || category;
    rawDateStr = findMetaValue(content, ["lastreaddate", "lastReadDate", "last_read_date", "readDate", "read_date", "finishReading", "date", "阅读日期"]) || rawDateStr;

    const h1Match = content.match(/^#\s+(.+)$/m);
    if (/^(untitled|未命名|readme)$/i.test(title) && h1Match) {
      const h1Title = h1Match[1].replace(/^《|》$/g, "").trim();
      if (h1Title && !/^(元数据|metadata|目录|说明)$/i.test(h1Title)) {
        title = h1Title;
      }
    }

    const lastReadTimestamp = normalizeDate(rawDateStr);

    // Dynamic category tagger fallback if missing
    if (!category) {
      const lowerTitle = title.toLowerCase();
      if (lowerTitle.includes("哲学") || lowerTitle.includes("思想") || lowerTitle.includes("道德") || lowerTitle.includes("存在") || lowerTitle.includes("自由") || lowerTitle.includes("智慧") || lowerTitle.includes("活着") || lowerTitle.includes("论")) {
        category = "哲学宗教";
      } else if (lowerTitle.includes("经济") || lowerTitle.includes("金融") || lowerTitle.includes("理财") || lowerTitle.includes("原则") || lowerTitle.includes("资本") || lowerTitle.includes("财富") || lowerTitle.includes("管理") || lowerTitle.includes("商业")) {
        category = "经济理财";
      } else if (lowerTitle.includes("科学") || lowerTitle.includes("技术") || lowerTitle.includes("算法") || lowerTitle.includes("代码") || lowerTitle.includes("互联网") || lowerTitle.includes("数字") || lowerTitle.includes("智能") || lowerTitle.includes("物理")) {
        category = "科学技术";
      } else if (lowerTitle.includes("习惯") || lowerTitle.includes("工作") || lowerTitle.includes("自控") || lowerTitle.includes("专注") || lowerTitle.includes("笔记") || lowerTitle.includes("方法") || lowerTitle.includes("自律") || lowerTitle.includes("思维")) {
        category = "认知与习惯";
      } else {
        category = "文学艺术";
      }
    }

    const highlights: string[] = [];
    const lines = content.split(/\r?\n/);
    let currentBlockquote = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const bqMatch = line.match(/^>\s*(.*)/);

      if (bqMatch) {
        const text = bqMatch[1].trim();
        currentBlockquote = currentBlockquote ? currentBlockquote + "\n" + text : text;
      } else {
        if (currentBlockquote) {
          // Process accumulated blockquote
          const cleaned = currentBlockquote.replace(/==/g, "").replace(/\[\[.*?\]\]/g, "").trim();
          if (cleaned.length > 4 && !cleaned.startsWith("[") && !cleaned.includes("作者:") && !cleaned.includes("封面:")) {
            highlights.push(cleaned);
          }
          currentBlockquote = "";
        }

        // Also look for double equals ==highlights== or custom lists
        if (line.includes("==")) {
          const doubleEqualsMatches = [...line.matchAll(/==(.*?)==/g)];
          doubleEqualsMatches.forEach(m => {
            if (m[1] && m[1].trim().length > 4) {
              highlights.push(m[1].trim());
            }
          });
        }

        const wereadHighlight = line.match(/^(?:划线|摘录|原文|quote|highlight)\s*[:：]\s*(.+)$/i);
        if (wereadHighlight?.[1] && wereadHighlight[1].trim().length > 4) {
          highlights.push(wereadHighlight[1].replace(/==/g, "").trim());
        }
      }
    }

    // Double check last blockquote
    if (currentBlockquote) {
      const cleaned = currentBlockquote.replace(/==/g, "").trim();
      if (cleaned.length > 4) {
        highlights.push(cleaned);
      }
    }

    // If still no highlights extracted, fallback to regular bullet lines only outside metadata sections.
    if (highlights.length === 0) {
      let insideMetadataSection = false;
      lines.forEach(line => {
        const trimmed = line.trim();
        const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
        if (heading) {
          insideMetadataSection = /^(元数据|metadata|信息|书籍信息|基本信息)$/i.test(heading[1].trim());
          return;
        }
        if (insideMetadataSection && trimmed === "") {
          return;
        }
        const listMatch = trimmed.match(/^[-*+]\s+(?:\[.\]\s*)?(.+)/);
        if (listMatch) {
          const text = listMatch[1].replace(/==/g, "").replace(/\s*\^[^\s]+$/g, "").trim();
          if (!insideMetadataSection && text.length > 8 && !/^(作者|封面|ISBN|title|author|cover|tags|date|出版社|出版|评分|状态|链接|source|url)\s*[:：]/i.test(text) && !text.includes("---")) {
            highlights.push(text);
          }
        }
      });
    }

    // Clean all highlights of Obsidian block references e.g. ^39805814-75vqF3aVK
    const cleanedHighlights = highlights
      .map(cleanHighlightText)
      .filter((h, idx, arr) => arr.indexOf(h) === idx)
      .filter(h => h.length > 3);

    return {
      title,
      author,
      cover,
      category,
      lastReadDate: lastReadTimestamp,
      sourceName: filename,
      sourcePath,
      highlights: cleanedHighlights
    };
  };

  const processFiles = useCallback(async (files: FileList) => {
    setIsProcessing(true);
    setParsedBooks([]);
    setImportCount(0);
    const mdFiles = Array.from(files).filter(file => {
      const sourcePath = ((file as any).webkitRelativePath || file.name) as string;
      const normalizedPath = sourcePath.replace(/\\/g, "/");
      const basename = file.name.replace(/\.(md|txt)$/i, "");
      const isMarkdown = /\.(md|txt)$/i.test(file.name);
      const isSystemPath = normalizedPath
        .split("/")
        .some(part => part.startsWith(".") || /^(_resources|assets|templates)$/i.test(part));
      const isMetadata = /^(元数据|metadata|meta|index|readme|目录|说明)$/i.test(basename.trim());
      return isMarkdown && !isSystemPath && !isMetadata;
    });

    if (mdFiles.length === 0) {
      setIsProcessing(false);
      alert("请导入 Markdown文件 (.md)！");
      return;
    }

    const readers = mdFiles.map(file => {
      return new Promise<ParsedBook | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result as string;
          const parsed = parseMarkdownContent(file.name, text, (file as any).webkitRelativePath || file.name);
          resolve(parsed);
        };
        reader.readAsText(file);
      });
    });

    try {
      const results = await Promise.all(readers);
      const validResults = results.filter((book): book is ParsedBook => !!book);

      setParsedBooks(() => {
        const combined: ParsedBook[] = [];
        validResults.forEach(newBook => {
          // Prevent exact duplicate files while allowing books with similar names.
          const existingIdx = combined.findIndex(b => b.sourcePath === newBook.sourcePath);
          if (existingIdx >= 0) {
            combined[existingIdx] = newBook;
          } else {
            combined.push(newBook);
          }
        });
        return combined;
      });

      setImportCount(validResults.length);
    } catch (err) {
      console.error("FileReader failed:", err);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = "";
    }
  };

  // Pre-load high quality Obsidian design template books so users can see how maps align instantly!
  const loadExampleNotes = () => {
    const examples = [
      {
        title: "卡片笔记写作法",
        author: "[德]申克·阿伦斯",
        cover: "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&auto=format&fit=crop&q=60",
        sourceName: "示例：卡片笔记写作法.md",
        sourcePath: "示例：卡片笔记写作法.md",
        highlights: [
          "一个不写的人，以为自己知道的东西往往比自己真正知道的要多。",
          "卢曼的卢卡斯盒笔记，是将临时笔记转化为永久笔记，重构个人终生认知索引的终极秘密。",
          "写卡片并非单向输出，而是脑中多元思想的无序碰撞与相互质询。"
        ]
      },
      {
        title: "大教堂与集市",
        author: "埃里克·斯蒂芬·雷蒙",
        cover: "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&auto=format&fit=crop&q=60",
        sourceName: "示例：大教堂与集市.md",
        sourcePath: "示例：大教堂与集市.md",
        highlights: [
          "只要有足够多的眼球，所有的Bug都将无处遁形。",
          "集市式的开放协同之所以超越大教堂的中心构架，核心在于对自组织智能的绝对解放。",
          "优秀的软件设计起步于解决开发者个人的切实痛点。"
        ]
      },
      {
        title: "瓦尔登湖",
        author: "[美] 亨利·戴维·梭罗",
        cover: "https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=400&auto=format&fit=crop&q=60",
        sourceName: "示例：瓦尔登湖.md",
        sourcePath: "示例：瓦尔登湖.md",
        highlights: [
          "多余的财富只能买多余的东西，而灵魂必需品是不需要花钱去买的。",
          "我步入丛林，因为我希望生活得有意义，我希望活得深刻，吸取生命中所有的精华。",
          "大多数人，即使在这个自由的国土上，也由于愚昧和误解，一生都在饱受无谓的工作折磨。"
        ]
      }
    ];

    setParsedBooks(examples);
    setImportCount(examples.length);
  };

  const handleApplyImport = () => {
    if (parsedBooks.length === 0) {
      alert("请导入 Markdown 文件或载入示例笔记！");
      return;
    }

    // Convert to compatible systems
    const localBooks: WeReadNotebook[] = parsedBooks.map((item, index) => {
      const bookId = `obsidian_${index}_${Math.abs(item.title.split("").reduce((a, b) => a + b.charCodeAt(0), 0))}`;
      // Use parsed lastReadDate if available, else spread backward from today
      const rawTime = item.lastReadDate || (Math.floor(Date.now() / 1000) - index * 86453 * 15);
      
      return {
        bookId,
        book: {
          bookId,
          title: item.title,
          author: item.author,
          cover: item.cover || "",
          readUpdateTime: rawTime,
          category: item.category || "文学艺术",
        },
        reviewCount: 0,
        noteCount: item.highlights.length,
        bookmarkCount: 0,
        markedStatus: 1,
        sort: rawTime
      };
    });

    const localHighlights: any[] = [];
    parsedBooks.forEach((item, index) => {
      const bookId = `obsidian_${index}_${Math.abs(item.title.split("").reduce((a, b) => a + b.charCodeAt(0), 0))}`;
      const baseTime = item.lastReadDate || (Math.floor(Date.now() / 1000) - index * 86453 * 15);
      
      item.highlights.forEach((h, hIdx) => {
        localHighlights.push({
          bookmarkId: `obs_quote_${index}_${hIdx}`,
          bookId,
          chapterUid: 100 + hIdx,
          markText: h,
          createTime: baseTime - hIdx * 3600, // Keep chronological spacing
          bookName: item.title,
          bookAuthor: item.author,
          bookCover: item.cover || ""
        });
      });
    });

    onImportComplete({ books: localBooks, highlights: localHighlights });
  };

  return (
    <div className="flex flex-col gap-5 p-1 bg-white font-sans text-[#2C2C26]" id="obsidian-importer-panel">
      {/* Importer Intro */}
      <div className="text-xs bg-[#2C2C26]/3 rounded-lg p-3.5 border border-[#2C2C26]/8 leading-relaxed space-y-1">
        <h4 className="font-semibold text-xs text-[#2C2C26] flex items-center gap-1.5 file:font-sans">
          <HelpCircle className="w-3.5 h-3.5 text-[#2C2C26]/60" />
          什么是 Obsidian 导入？
        </h4>
        <p className="text-[#2C2C26]/75">
          因为浏览器运行在安全沙箱环境中，项目无法直接在后台静默读取您的原生电脑硬盘。但你可以通过
          <strong className="text-[#2C2C26] font-medium mx-1">微信读书 Obsidian 同步插件</strong>
          等一键同步划线到 Obsidian Vault 后，直接将该笔记文件夹内的任何
          <code className="bg-[#2C2C26]/5 px-1 py-0.5 rounded text-[10px] font-mono mx-1">.md</code>
          文件多选，并拖入本界面。我们将为您本地解析并重组视觉图谱！
        </p>
      </div>

      {/* Drag & Drop Zone */}
      <div
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        className={`w-full border-2 border-dashed rounded-xl py-8 px-5 flex flex-col items-center justify-center transition-all duration-200 text-center cursor-pointer ${
          dragActive
            ? "border-[#2C2C26] bg-[#2C2C26]/8"
            : "border-[#2C2C26]/15 hover:border-[#2C2C26]/40 bg-gray-50/50 hover:bg-[#2C2C26]/3"
        }`}
        onClick={() => document.getElementById("obsidian-file-picker")?.click()}
      >
        <input
          id="obsidian-file-picker"
          type="file"
          multiple
          accept=".md,.txt"
          className="hidden"
          onChange={handleFileInput}
        />
        <input
          id="obsidian-folder-picker"
          type="file"
          multiple
          accept=".md,.txt"
          className="hidden"
          onChange={handleFileInput}
          {...({ webkitdirectory: "", directory: "" } as any)}
        />
        
        {isProcessing ? (
          <div className="space-y-2">
            <RefreshCw className="w-8 h-8 text-[#2C2C26]/40 animate-spin mx-auto animate-fade-in" />
            <p className="text-sm font-medium">正在扫描并解析 Markdown 笔记...</p>
          </div>
        ) : (
          <div className="space-y-2 text-[#2C2C26]">
            <Upload className="w-8 h-8 text-[#2C2C26]/55 mx-auto" />
            <p className="text-xs font-medium">
              将 Obsidian 笔记文件拖到这里，或
              <span className="text-amber-700 underline font-medium mx-1 cursor-pointer">点击选择</span>
            </p>
            <p className="text-[10px] text-[#2C2C26]/40">支持多选 .md 文件直接一次性导入</p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                document.getElementById("obsidian-folder-picker")?.click();
              }}
              className="mt-2 px-3 py-1.5 bg-white border border-[#2C2C26]/15 hover:border-[#2C2C26]/35 rounded text-[10px] font-medium shadow-3xs cursor-pointer"
            >
              选择整个文件夹
            </button>
          </div>
        )}
      </div>

      {/* Parsed Output Details */}
      {parsedBooks.length > 0 && (
        <div className="border border-[#2C2C26]/10 rounded-lg p-3 bg-white space-y-2">
          <div className="flex items-center justify-between border-b border-[#2C2C26]/5 pb-1.5 text-[11px] font-mono">
            <span className="text-[#2C2C26]/60">已装载书籍：{parsedBooks.length} 本</span>
            <button
              onClick={() => {
                setParsedBooks([]);
                setImportCount(0);
              }}
              className="text-red-600/70 hover:text-red-600 text-[10px] flex items-center gap-1 cursor-pointer font-sans"
            >
              <Trash2 className="w-3" />
              清空
            </button>
          </div>

          <div className="max-h-36 overflow-y-auto space-y-1.5 scrollbar-thin">
            {parsedBooks.map((book, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs p-2 bg-[#2C2C26]/2 rounded border border-[#2C2C26]/5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileText className="w-3.5 h-3.5 text-[#2C2C26]/50 flex-shrink-0" />
                  <div className="min-w-0">
                    <span className="truncate font-medium text-[#2C2C26] block">{book.title}</span>
                    <span className="truncate text-[9px] text-[#2C2C26]/45 font-mono block" title={book.sourcePath}>
                      来源：{book.sourceName}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] text-gray-500 font-mono">✍️ {book.highlights.length} 条划线</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Importer Actions */}
      <div className="flex items-center gap-2 w-full pt-2">
        <button
          onClick={loadExampleNotes}
          className="flex-1 py-2 rounded text-xs border border-[#2C2C26]/20 bg-white hover:bg-gray-50 text-[#2C2C26] font-medium transition-all cursor-pointer"
        >
          载入示例笔记
        </button>
        <button
          onClick={handleApplyImport}
          disabled={parsedBooks.length === 0}
          className="flex-1 py-2 bg-[#2C2C26] hover:bg-[#2C2C26]/90 disabled:opacity-50 text-white rounded text-xs font-semibold tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>确认保存并生成!</span>
        </button>
      </div>
    </div>
  );
}
