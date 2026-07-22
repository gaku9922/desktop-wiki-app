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

//  添付方式。type は file / folder / article / link、method は保存場所・種別を表す
export type AttachmentMethod =
  | 'inArticleDir'
  | 'inFileServer'
  | 'Article'
  | 'externalUrl';

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

//  外部リンクの添付（既定ブラウザで開く）。url は http/https のみ許可
export interface LinkAttachment {
  type: 'link';
  method: 'externalUrl';
  url: string;
  name?: string; // 表示名（省略時は url を表示）
}

export type AttachmentRef = FileAttachment | ArticleAttachment | LinkAttachment;

export interface SpaceSkill {
  business: string[];
  skill: string[];
}

//  記事本体（UGBxxxx.json のスキーマ）
//  ※ body は JSON には持たず、同ディレクトリの <id>.md から読み込む（メモリ上の表現）
export interface Article {
  id: string;
  title: string;
  createdAt: string; // ISO 8601 JST: "YYYY-MM-DDTHH:MM:SS+09:00"
  createdBy: string; // 作成者
  updatedAt: string;
  updatedBy: string; // 更新者
  tags: string[];
  spaceSkill: SpaceSkill;
  body: string;      // 本文（<id>.md の内容。将来 Markdown レンダリング予定）
  attachments: AttachmentRef[];
}

//  一覧・サイドバー・最新更新用の軽量サマリ
export interface ArticleSummary {
  id: string;
  title: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
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
  kind: 'file' | 'folder' | 'article' | 'link';
  method: AttachmentMethod;
  displayName: string;
  ext?: string;
  exists: boolean;      // file/folder: 実在チェック / article: ID解決可否 / link: URL形式が妥当か
  path?: string;        // file/folder: 解決済みパス（パス切れ警告の表示用）
  url?: string;         // link: 外部URL
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

//  外部リンクを開いた結果
export type OpenLinkResult =
  | { status: 'ok' }
  | { status: 'invalid'; url?: string } // http/https 以外、または不正なURL
  | { status: 'error'; message: string };

// ================================================================== //
//  新規記事作成
// ================================================================== //

//  スキル/業務のプルダウン候補（major でグルーピング表示）
export interface MatrixOption {
  id: string;
  label: string;
  majorId: string;
  majorLabel: string;
}
export interface MatrixOptions {
  skills: MatrixOption[];
  business: MatrixOption[];
}

//  パス選択ダイアログ（アップロード方式のステージング用。コピーはしない）
export interface PickedPath {
  path: string;
  kind: 'file' | 'folder';
  name: string;
}

//  新規作成時の添付入力（保存時にバックエンドが AttachmentRef へ解決）
export type CreateAttachmentInput =
  | { kind: 'upload'; sourcePath: string; fileType: 'file' | 'folder'; name: string }
  | { kind: 'fileServer'; path: string; fileType: 'file' | 'folder' }
  | { kind: 'article'; id: string }
  | { kind: 'link'; url: string; name?: string };

//  新規記事作成の入力
export interface CreateArticleInput {
  categoryPath: string[]; // 最終的な配置先（既存＋新規サブディレクトリを含む）
  title: string;
  body: string;           // 本文（トリム後1文字以上・必須）
  anonymous: boolean;     // true: createdBy/updatedBy を "匿名"
  tags: string[];
  skill: string[];        // SK-xxxx
  business: string[];     // BZ-xxxx
  attachments: CreateAttachmentInput[];
}

export type CreateArticleResult =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string };

//  ディレクトリ作成の結果
export type CreateDirectoryResult =
  | { status: 'ok' }
  | { status: 'error'; message: string };

//  編集時の添付。既存（読み込んだ AttachmentRef）と新規追加（CreateAttachmentInput）の混在
export type EditAttachmentInput =
  | { source: 'existing'; ref: AttachmentRef }
  | { source: 'new'; input: CreateAttachmentInput };

//  既存記事の更新入力（id/createdAt/createdBy は保持、updated系は自動更新）
export interface UpdateArticleInput {
  id: string;
  categoryPath: string[]; // 変更時は記事を移動する
  title: string;
  body: string;
  anonymous: boolean;
  tags: string[];
  skill: string[];
  business: string[];
  attachments: EditAttachmentInput[];
}

export type UpdateArticleResult =
  | { status: 'ok'; id: string }
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
  openLink(
    articleId: string,
    attachmentIndex: number,
  ): Promise<OpenLinkResult>;
  matrixOptions(): Promise<MatrixOptions>;
  pickPath(mode: 'file' | 'folder'): Promise<PickedPath | null>;
  createArticle(input: CreateArticleInput): Promise<CreateArticleResult>;
  updateArticle(input: UpdateArticleInput): Promise<UpdateArticleResult>;
  createDirectory(
    parentPath: string[],
    name: string,
  ): Promise<CreateDirectoryResult>;
  refresh(): Promise<void>;
}

export interface ArticleGetPayload {
  id: string;
}

export interface AttachDownloadPayload {
  articleId: string;
  attachmentIndex: number;
}

export interface OpenLinkPayload {
  articleId: string;
  attachmentIndex: number;
}

export interface PickPathPayload {
  mode: 'file' | 'folder';
}

export interface CreateDirectoryPayload {
  parentPath: string[];
  name: string;
}
