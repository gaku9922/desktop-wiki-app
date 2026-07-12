// ------------------------------------------------------------------ //
//  型定義（フロントエンド・バックエンド共通）
// ------------------------------------------------------------------ //
export type JsonFileNode = {
  name: string;
  relativePath: string;
  type: 'json';
};

export type OtherFileNode = {
  name: string;
  relativePath: string;
  type: 'file';
};

export type DirNode = {
  name: string;
  relativePath: string;
  type: 'dir';
  children: TreeNode[];
};

export type TreeNode = JsonFileNode | OtherFileNode | DirNode;

export type JsonValue = unknown;

// ------------------------------------------------------------------ //
//  ユーザー情報
// ------------------------------------------------------------------ //
export interface UserConfig {
  name: string;
}

export interface FileAPI {
  getRootDir(): Promise<string>;
  list(): Promise<TreeNode[]>;
  read(relativePath: string): Promise<JsonValue>;
  write(relativePath: string, data: JsonValue): Promise<TreeNode[]>;
  delete(relativePath: string): Promise<TreeNode[]>;
  download(relativePath: string): Promise<void>;
  upload(destRelativeDir: string): Promise<TreeNode[]>;
}

// ------------------------------------------------------------------ //
//  ユーザー情報の読み書き API（ファイル操作とは別系統）
// ------------------------------------------------------------------ //
export interface UserAPI {
  // 未登録の場合は null を返す
  get(): Promise<UserConfig | null>;
  save(name: string): Promise<UserConfig>;
}

export interface ReadPayload {
  relativePath: string;
}

export interface WritePayload {
  relativePath: string;
  data: JsonValue;
}

export interface DeletePayload {
  relativePath: string;
}

export interface DownloadPayload {
  relativePath: string;
}

export interface UploadPayload {
  destRelativeDir: string;
}

export interface SaveUserPayload {
  name: string;
}

// ================================================================== //
//  Wikiアプリ: 記事ドメインモデル
// ================================================================== //

//  添付方式。type は file / folder / article、method は保存場所を表す
export type AttachmentMethod = 'inArticleDir' | 'inFileServer' | 'Article';

//  ファイル / フォルダ添付（記事内 or 共有サーバ）
export interface FileAttachment {
  type: 'file' | 'folder';
  method: 'inArticleDir' | 'inFileServer';
  name: string;
  ext?: string;   // file のみ。folder は持たない
  path?: string;  // inFileServer は絶対パス、inArticleDir は再構築するため任意
}

//  関連記事の添付（記事IDで参照）
export interface ArticleAttachment {
  type: 'article';
  method: 'Article';
  id: string;
}

export type AttachmentRef = FileAttachment | ArticleAttachment;

export interface SpaceSkill {
  business: string[];
  skill: string[];
}

//  記事本体（UGBxxxx.json のスキーマ）
export interface Article {
  id: string;
  title: string;
  author: string;
  createdAt: string; // ISO 8601 JST: "YYYY-MM-DDTHH:MM:SS+09:00"
  updatedAt: string;
  tags: string[];
  spaceSkill: SpaceSkill;
  body: string;
  attachments: AttachmentRef[];
}

//  一覧・サイドバー・最新更新用の軽量サマリ
export interface ArticleSummary {
  id: string;
  title: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  relativePath: string;   // 例: プロジェクト別/H3/UGB0006/UGB0006.json
  categoryPath: string[]; // 例: ["プロジェクト別","H3"]
}

//  サイドバーのWikiツリー
export interface WikiCategoryNode {
  type: 'category';
  name: string;
  path: string[];
  children: WikiTreeNode[];
}

export interface WikiArticleNode {
  type: 'article';
  id: string;
  title: string;
  relativePath: string;
}

export type WikiTreeNode = WikiCategoryNode | WikiArticleNode;

//  記事閲覧時、添付は解決済みメタを付与して返す
export interface ResolvedAttachment {
  kind: 'file' | 'folder' | 'article';
  method: AttachmentMethod;
  displayName: string;
  ext?: string;
  exists: boolean;      // file/folder: 実在チェック / article: ID解決可否
  path?: string;        // file/folder: 解決済みパス（パス切れ警告の表示用）
  linkedId?: string;    // article: 遷移先ID
  linkedTitle?: string; // article: 遷移先タイトル
}

//  SK/BZ の ID とラベル（matrix CSV で解決）
export interface SkillLabel {
  id: string;
  label: string;
}

//  記事取得の返却
export interface ArticleDetail {
  article: Article;
  categoryPath: string[];
  attachments: ResolvedAttachment[];
  skill: SkillLabel[];
  business: SkillLabel[];
}

//  添付ダウンロードの結果
export type AttachDownloadResult =
  | { status: 'ok' }
  | { status: 'canceled' }
  | { status: 'missing'; path: string }
  | { status: 'error'; message: string };

// ------------------------------------------------------------------ //
//  記事系 API（ファイル操作とは別系統）
// ------------------------------------------------------------------ //
export interface ArticleAPI {
  tree(): Promise<WikiTreeNode[]>;
  index(): Promise<ArticleSummary[]>;
  get(id: string): Promise<ArticleDetail | null>;
  downloadAttachment(
    articleId: string,
    attachmentIndex: number,
  ): Promise<AttachDownloadResult>;
  refresh(): Promise<void>;
}

export interface ArticleGetPayload {
  id: string;
}

export interface AttachDownloadPayload {
  articleId: string;
  attachmentIndex: number;
}
