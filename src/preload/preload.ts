import { contextBridge, ipcRenderer } from 'electron';
import type { ArticleAPI, FileAPI, JsonValue, UserAPI } from '../shared/types';

// ------------------------------------------------------------------ //
//  フロントエンドに公開するAPIの定義
// ------------------------------------------------------------------ //
const fileAPI: FileAPI = {
  getRootDir: () => ipcRenderer.invoke('fs:getRootDir'),

  list: () => ipcRenderer.invoke('fs:list'),

  read: (relativePath: string) =>
    ipcRenderer.invoke('fs:read', { relativePath }),

  write: (relativePath: string, data: JsonValue) =>
    ipcRenderer.invoke('fs:write', { relativePath, data }),

  delete: (relativePath: string) =>
    ipcRenderer.invoke('fs:delete', { relativePath }),

  download: (relativePath: string) =>
    ipcRenderer.invoke('fs:download', { relativePath }),

  upload: (destRelativeDir: string) =>
    ipcRenderer.invoke('fs:upload', { destRelativeDir }),
};

// ------------------------------------------------------------------ //
//  ユーザー情報 API の定義
// ------------------------------------------------------------------ //
const userAPI: UserAPI = {
  get: () => ipcRenderer.invoke('user:get'),

  save: (name: string) => ipcRenderer.invoke('user:save', { name }),
};

// ------------------------------------------------------------------ //
//  記事系 API の定義
// ------------------------------------------------------------------ //
const articleAPI: ArticleAPI = {
  tree: () => ipcRenderer.invoke('article:tree'),

  index: () => ipcRenderer.invoke('article:index'),

  get: (id: string) => ipcRenderer.invoke('article:get', { id }),

  downloadAttachment: (articleId: string, attachmentIndex: number) =>
    ipcRenderer.invoke('attach:download', { articleId, attachmentIndex }),

  openLink: (articleId: string, attachmentIndex: number) =>
    ipcRenderer.invoke('link:open', { articleId, attachmentIndex }),

  matrixOptions: () => ipcRenderer.invoke('matrix:options'),

  pickPath: (mode: 'file' | 'folder') =>
    ipcRenderer.invoke('dialog:pickPath', { mode }),

  createArticle: (input) => ipcRenderer.invoke('article:create', input),

  updateArticle: (input) => ipcRenderer.invoke('article:update', input),

  deleteArticle: (id: string) => ipcRenderer.invoke('article:delete', { id }),

  search: (query: string) => ipcRenderer.invoke('article:search', { query }),

  createDirectory: (parentPath: string[], name: string) =>
    ipcRenderer.invoke('dir:create', { parentPath, name }),

  refresh: () => ipcRenderer.invoke('article:refresh'),
};

// ------------------------------------------------------------------ //
//  APIの公開
// ------------------------------------------------------------------ //
contextBridge.exposeInMainWorld('fileAPI', fileAPI);
contextBridge.exposeInMainWorld('userAPI', userAPI);
contextBridge.exposeInMainWorld('articleAPI', articleAPI);
