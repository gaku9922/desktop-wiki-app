// ------------------------------------------------------------------ //
//  フロントエンドへの型拡張
// ------------------------------------------------------------------ //
import type {
  FileAPI,
  UserAPI,
  ArticleAPI,
  FavoriteAPI,
  TreeNode as SharedTreeNode,
  WikiTreeNode as SharedWikiTreeNode,
  WikiCategoryNode as SharedWikiCategoryNode,
  ArticleSummary as SharedArticleSummary,
  ArticleDetail as SharedArticleDetail,
  ResolvedAttachment as SharedResolvedAttachment,
  AttachDownloadResult as SharedAttachDownloadResult,
  MatrixOptions as SharedMatrixOptions,
  MatrixOption as SharedMatrixOption,
  PickedPath as SharedPickedPath,
  CreateArticleInput as SharedCreateArticleInput,
  CreateAttachmentInput as SharedCreateAttachmentInput,
  CreateArticleResult as SharedCreateArticleResult,
  EditAttachmentInput as SharedEditAttachmentInput,
  UpdateArticleInput as SharedUpdateArticleInput,
  UpdateArticleResult as SharedUpdateArticleResult,
} from '../shared/types';

declare global {
  interface Window {
    fileAPI: FileAPI;
    userAPI: UserAPI;
    articleAPI: ArticleAPI;
    favAPI: FavoriteAPI;
  }

  type TreeNode = SharedTreeNode;
  type WikiTreeNode = SharedWikiTreeNode;
  type WikiCategoryNode = SharedWikiCategoryNode;
  type ArticleSummary = SharedArticleSummary;
  type ArticleDetail = SharedArticleDetail;
  type ResolvedAttachment = SharedResolvedAttachment;
  type AttachDownloadResult = SharedAttachDownloadResult;
  type MatrixOptions = SharedMatrixOptions;
  type MatrixOption = SharedMatrixOption;
  type PickedPath = SharedPickedPath;
  type CreateArticleInput = SharedCreateArticleInput;
  type CreateAttachmentInput = SharedCreateAttachmentInput;
  type CreateArticleResult = SharedCreateArticleResult;
  type EditAttachmentInput = SharedEditAttachmentInput;
  type UpdateArticleInput = SharedUpdateArticleInput;
  type UpdateArticleResult = SharedUpdateArticleResult;
}

export {};
