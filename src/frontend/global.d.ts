// ------------------------------------------------------------------ //
//  フロントエンドへの型拡張
// ------------------------------------------------------------------ //
import type {
  FileAPI,
  UserAPI,
  ArticleAPI,
  TreeNode as SharedTreeNode,
  WikiTreeNode as SharedWikiTreeNode,
  WikiCategoryNode as SharedWikiCategoryNode,
  ArticleSummary as SharedArticleSummary,
  ArticleDetail as SharedArticleDetail,
  ResolvedAttachment as SharedResolvedAttachment,
  AttachDownloadResult as SharedAttachDownloadResult,
} from '../shared/types';

declare global {
  interface Window {
    fileAPI: FileAPI;
    userAPI: UserAPI;
    articleAPI: ArticleAPI;
  }

  type TreeNode = SharedTreeNode;
  type WikiTreeNode = SharedWikiTreeNode;
  type WikiCategoryNode = SharedWikiCategoryNode;
  type ArticleSummary = SharedArticleSummary;
  type ArticleDetail = SharedArticleDetail;
  type ResolvedAttachment = SharedResolvedAttachment;
  type AttachDownloadResult = SharedAttachDownloadResult;
}

export {};
