// ------------------------------------------------------------------ //
//  フロントエンドへの型拡張
// ------------------------------------------------------------------ //
import type { FileAPI, UserAPI, TreeNode as SharedTreeNode } from '../shared/types';

declare global {
  interface Window {
    fileAPI: FileAPI;
    userAPI: UserAPI;
  }

  type TreeNode = SharedTreeNode;
}

export {};
