export interface BookChapter {
  id: string;
  title: string;
  href: string;
  html: string;
  text: string;
  wordCount: number;
  imageCount: number;
  /** Linked notes and other documents outside the primary spine sequence. */
  auxiliary?: boolean;
}

export interface BookTocItem {
  title: string;
  chapterId: string;
  fragment?: string;
  level: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  language: string;
  description: string;
  publisher?: string;
  coverUrl?: string;
  chapters: BookChapter[];
  toc: BookTocItem[];
  wordCount: number;
  imageCount: number;
  isDemo?: boolean;
  resourceUrls: string[];
}

export type Theme = "paper" | "sepia" | "dark";
export interface ReadingSettings {
  fontSize: number;
  columns: 1 | 2;
  theme: Theme;
  showFigures: boolean;
}

export interface SavedBook {
  id: string;
  title: string;
  author: string;
  file: Blob;
  addedAt: number;
  chapterIndex: number;
}
