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
