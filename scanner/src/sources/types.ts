import type { SearchConfig } from '../config.js';
import type { RawRange } from '../rules/salary.js';
import type { Ats, Board } from '../schema.js';

/** One posting as read from an official ATS, before any classification. */
export interface Posting {
  ats: Ats;
  board: string;
  atsId: string;
  company: string;
  title: string;
  locationText: string;
  workplaceType: 'remote' | 'hybrid' | 'onsite' | null;
  isRemote: boolean | null;
  employmentType: string | null;
  postedAt: string | null;
  officialUrl: string;
  applyUrl: string;
  reqId: string | null;
  description: string;
  ranges: RawRange[];
}

export interface BoardListing {
  company: string;
  postings: Posting[];
  /**
   * true when the listing contains every open job on the board, so a missing job means "closed".
   * Search-based sources (Workday) are incomplete; their missing jobs are re-checked individually.
   */
  complete: boolean;
  /** Total postings on the board before title filtering (for scan statistics). */
  examined: number;
}

export interface SourceAdapter {
  ats: Ats;
  list(board: Board, search: SearchConfig, titleFilter: (t: string) => boolean): Promise<BoardListing>;
  /** Fetch extra detail (e.g. pay ranges) for a posting that passed the title filter. */
  enrich?(p: Posting): Promise<Posting>;
  /** Individually check a previously-seen job (for incomplete sources). */
  isOpen?(board: Board, atsId: string, officialUrl: string): Promise<boolean>;
  /** Does a board with this slug exist? Used when probing newly discovered companies. */
  probe(slug: string): Promise<{ exists: boolean; company?: string }>;
}
