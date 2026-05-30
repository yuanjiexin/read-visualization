/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface WeReadBook {
  bookId: string;
  title: string;
  author: string;
  cover: string;
  category?: string;
  categories?: Array<{ categoryId: number; title: string }>;
  readUpdateTime?: number;
  finishReading?: number;
  publishTime?: string;
}

export interface WeReadNotebook {
  bookId: string;
  book: WeReadBook;
  reviewCount: number;
  noteCount: number;
  bookmarkCount: number;
  readingProgress?: number;
  markedStatus: number; // 1=读完, 0=在读
  sort: number;
}

export interface WeReadHighlight {
  bookmarkId: string;
  bookId: string;
  chapterUid: number;
  chapterIdx?: number;
  markText: string;
  createTime: number;
  type: number; // 1=划线
  range: string; // e.g. "900-2004"
  colorStyle?: number;
}

export interface WeReadChapter {
  chapterUid: number;
  chapterIdx: number;
  title: string;
}

export interface WeReadBookNotesResponse {
  synckey: number;
  updated: WeReadHighlight[];
  chapters: WeReadChapter[];
  book: WeReadBook;
}

export interface PreferCategory {
  categoryId: number;
  categoryTitle: string;
  parentCategoryId?: number;
  parentCategoryTitle?: string;
  val: number;
  readingTime: number;
  readingCount: number;
}

export interface ReadStat {
  stat: string; // e.g. "读过", "读完", "阅读", "笔记"
  counts: string; // e.g. "179本", "49本", "858天", "2141条"
  scheme?: string;
}

export interface ReadLongestItem {
  book?: WeReadBook;
  readTime: number;
  tags?: string[];
}

export interface WeReadOverallStats {
  user?: { name: string; avatar?: string };
  readingCount?: number;
  noteCount?: number;
  readDays?: number;
  totalReadTime?: number;
  preferCategory: PreferCategory[];
  preferCategoryWord?: string;
  preferTimeWord?: string;
  preferTime?: number[];
  readStat: ReadStat[];
  registTime?: number;
  readLongest?: ReadLongestItem[];
}

// Canvas & Vision State
export interface CanvasTransform {
  x: number;
  y: number;
  zoom: number;
}

export interface ThoughtNode {
  id: string;
  type: 'concept' | 'book' | 'quote';
  label: string;
  x: number;
  y: number;
  meta?: any;
}

export interface ThoughtLink {
  source: string;
  target: string;
  type: 'core' | 'related' | 'weak';
}
