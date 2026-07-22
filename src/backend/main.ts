import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron';
import path from 'path';
import dotenv from 'dotenv';
import FileManager from './fileManager';
import ArticleManager from './articleManager';
import SkillMatrix from './skillMatrix';
import FavoritesManager from './favoritesManager';
import type {
  ArticleGetPayload,
  AttachDownloadPayload,
  AttachDownloadResult,
  CreateArticleInput,
  CreateArticleResult,
  CreateDirectoryPayload,
  CreateDirectoryResult,
  UpdateArticleInput,
  UpdateArticleResult,
  DeleteArticlePayload,
  DeleteArticleResult,
  SearchPayload,
  ToggleFavoritePayload,
  DeletePayload,
  DownloadPayload,
  OpenLinkPayload,
  OpenLinkResult,
  OpenUrlPayload,
  PickPathPayload,
  PickedPath,
  ReadPayload,
  SaveUserPayload,
  UploadPayload,
  UserConfig,
  WritePayload,
} from '../shared/types';

// ------------------------------------------------------------------ //
//  定数: ユーザー情報の保存ファイル名（userData 配下に置く）
// ------------------------------------------------------------------ //
const USER_FILE = 'user.json';

// ------------------------------------------------------------------ //
//  定数: 操作対象のルートディレクトリ
// ------------------------------------------------------------------ //
dotenv.config({ path: path.join(app.getAppPath(), '.env') });

const ROOT_DIR: string = process.env.ROOT_DIR ?? (() => {
  throw new Error('.env に ROOT_DIR が設定されていません');
})();

// ------------------------------------------------------------------ //
//  共有リンク（カスタムURLスキーム）: ugbwiki://article/<ID>
// ------------------------------------------------------------------ //
const URL_SCHEME = 'ugbwiki';
let mainWindow: BrowserWindow | null = null;
// ウィンドウ準備前に受け取ったディープリンクを保留
let pendingRoute: string | null = null;

//  ugbwiki://article/UGB0001 → '#/article/UGB0001'（IDを厳格検証）
const deepLinkToHash = (url: string): string | null => {
  const m = new RegExp(`^${URL_SCHEME}://article/(UGB\\d+)/?$`, 'i').exec(url.trim());
  return m ? `#/article/${m[1]}` : null;
};

//  ディープリンクを処理してレンダラーへ遷移指示（未準備なら保留）
const handleDeepLink = (url: string): void => {
  const hash = deepLinkToHash(url);
  if (!hash) return;
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('app:navigate', hash);
  } else {
    pendingRoute = hash;
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
};

// ------------------------------------------------------------------ //
//  ウィンドウ生成
// ------------------------------------------------------------------ //
const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
    },
  });
  win.loadFile(path.join(__dirname, '../frontend/index.html'));
  mainWindow = win;
  // 読み込み完了後、保留していたディープリンクを反映
  win.webContents.on('did-finish-load', () => {
    if (pendingRoute) {
      win.webContents.send('app:navigate', pendingRoute);
      pendingRoute = null;
    }
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
};

// ------------------------------------------------------------------ //
//  IPC ハンドラ登録
// ------------------------------------------------------------------ //
const registerIpcHandlers = (
  fm: FileManager,
  userFm: FileManager,
  am: ArticleManager,
  matrix: SkillMatrix,
  favorites: FavoritesManager,
): void => {
  // ROOT_DIR のパスを返す
  ipcMain.handle('fs:getRootDir', () => ROOT_DIR);

  // ツリー一覧を返す
  ipcMain.handle('fs:list', () => fm.listTree());

  // JSON ファイルを読み込む
  ipcMain.handle('fs:read', (_event, { relativePath }: ReadPayload) =>
    fm.readJson(relativePath),
  );

  // JSON ファイルを書き込む（新規作成 / 上書き）
  ipcMain.handle('fs:write', (_event, { relativePath, data }: WritePayload) => {
    fm.writeJson(relativePath, data);
    am.invalidate();
    return fm.listTree();
  });

  // JSON ファイルを削除する
  ipcMain.handle('fs:delete', (_event, { relativePath }: DeletePayload) => {
    fm.deleteJson(relativePath);
    am.invalidate();
    return fm.listTree();
  });

  // ------------------------------------------------------------------ //
  //  Wiki記事: サイドバーツリー / 一覧インデックス / 記事詳細 / 再構築
  // ------------------------------------------------------------------ //
  ipcMain.handle('article:tree', () => am.getTree());

  ipcMain.handle('article:index', () => am.getIndex());

  ipcMain.handle('article:get', (_event, { id }: ArticleGetPayload) =>
    am.getArticleDetail(id),
  );

  ipcMain.handle('article:refresh', () => {
    am.invalidate();
  });

  // キーワード検索（タイトル＋本文）
  ipcMain.handle('article:search', (_event, { query }: SearchPayload) =>
    am.search(query),
  );

  // お気に入り: 一覧（存在検証込み）/ トグル
  ipcMain.handle('fav:list', () => favorites.list());
  ipcMain.handle('fav:toggle', (_event, { id }: ToggleFavoritePayload) =>
    favorites.toggle(id),
  );

  // ------------------------------------------------------------------ //
  //  添付ダウンロード: file はコピー、folder はそのまま再帰コピー
  //  パス切れ（存在しない）は missing を返す
  // ------------------------------------------------------------------ //
  ipcMain.handle(
    'attach:download',
    async (
      _event,
      { articleId, attachmentIndex }: AttachDownloadPayload,
    ): Promise<AttachDownloadResult> => {
      try {
        const target = await am.resolveForDownload(articleId, attachmentIndex);
        if (!target || target.kind === 'article') {
          return { status: 'error', message: '添付が見つかりません。' };
        }
        if (!target.exists) {
          return { status: 'missing', path: target.absPath };
        }

        if (target.kind === 'file') {
          const { canceled, filePath } = await dialog.showSaveDialog({
            defaultPath: target.name,
          });
          if (canceled || !filePath) return { status: 'canceled' };
          await am.copyFile(target.absPath, filePath);
          return { status: 'ok' };
        }

        // folder
        const { canceled, filePaths } = await dialog.showOpenDialog({
          title: '保存先フォルダを選択',
          properties: ['openDirectory', 'createDirectory'],
        });
        if (canceled || filePaths.length === 0) return { status: 'canceled' };
        await am.copyFolder(target.absPath, filePaths[0]);
        return { status: 'ok' };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // ------------------------------------------------------------------ //
  //  外部リンク: 既定ブラウザで開く。http/https のみ許可（スキーム検証）
  // ------------------------------------------------------------------ //
  ipcMain.handle(
    'link:open',
    async (
      _event,
      { articleId, attachmentIndex }: OpenLinkPayload,
    ): Promise<OpenLinkResult> => {
      const resolved = am.resolveLinkForOpen(articleId, attachmentIndex);
      if (!resolved) return { status: 'invalid' };
      try {
        // 多層防御: 開く直前にもスキームを再検証
        const proto = new URL(resolved.url).protocol;
        if (proto !== 'http:' && proto !== 'https:') {
          return { status: 'invalid', url: resolved.url };
        }
        await shell.openExternal(resolved.url);
        return { status: 'ok' };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // 任意URLを既定ブラウザで開く（http/https のみ）
  ipcMain.handle(
    'link:openUrl',
    async (_event, { url }: OpenUrlPayload): Promise<OpenLinkResult> => {
      try {
        const proto = new URL(url).protocol;
        if (proto !== 'http:' && proto !== 'https:') {
          return { status: 'invalid', url };
        }
        await shell.openExternal(url);
        return { status: 'ok' };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // ------------------------------------------------------------------ //
  //  スキル/業務のプルダウン候補
  // ------------------------------------------------------------------ //
  ipcMain.handle('matrix:options', () => matrix.options());

  // 宇宙スキル標準マトリクス（大項目→小項目・関係グラフ）
  ipcMain.handle('matrix:full', () => matrix.getMatrix());

  // ------------------------------------------------------------------ //
  //  パス選択ダイアログ（コピーはしない。アップロード方式のステージング用）
  //  mode で「ファイル」または「フォルダ」を選ばせる（Windowsの同時選択制約を回避）
  // ------------------------------------------------------------------ //
  ipcMain.handle(
    'dialog:pickPath',
    async (_event, { mode }: PickPathPayload): Promise<PickedPath | null> => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: [mode === 'folder' ? 'openDirectory' : 'openFile'],
      });
      if (canceled || filePaths.length === 0) return null;
      const p = filePaths[0];
      return { path: p, kind: mode, name: path.basename(p) };
    },
  );

  // ------------------------------------------------------------------ //
  //  新規記事作成。作成者名は userData の user.json を正とする
  // ------------------------------------------------------------------ //
  ipcMain.handle(
    'article:create',
    async (_event, input: CreateArticleInput): Promise<CreateArticleResult> => {
      try {
        let userName = '';
        try {
          userName = (userFm.readJson(USER_FILE) as UserConfig).name;
        } catch {
          userName = '';
        }
        const id = await am.createArticle(input, userName);
        return { status: 'ok', id };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // ------------------------------------------------------------------ //
  //  既存記事の更新。作成者名は userData の user.json を正とする
  // ------------------------------------------------------------------ //
  ipcMain.handle(
    'article:update',
    async (_event, input: UpdateArticleInput): Promise<UpdateArticleResult> => {
      try {
        let userName = '';
        try {
          userName = (userFm.readJson(USER_FILE) as UserConfig).name;
        } catch {
          userName = '';
        }
        const id = await am.updateArticle(input, userName);
        return { status: 'ok', id };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // ------------------------------------------------------------------ //
  //  記事削除（記事ディレクトリを丸ごと撤去）
  // ------------------------------------------------------------------ //
  ipcMain.handle(
    'article:delete',
    (_event, { id }: DeleteArticlePayload): DeleteArticleResult => {
      try {
        am.deleteArticle(id);
        return { status: 'ok' };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // クリップボードへ書き込む（共有リンクのコピー用）
  ipcMain.handle('clip:write', (_event, { text }: { text: string }) => {
    clipboard.writeText(text);
  });

  // ------------------------------------------------------------------ //
  //  新規ディレクトリ作成（親ディレクトリ配下）
  // ------------------------------------------------------------------ //
  ipcMain.handle(
    'dir:create',
    (_event, { parentPath, name }: CreateDirectoryPayload): CreateDirectoryResult => {
      try {
        am.createDirectory(parentPath, name);
        return { status: 'ok' };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // ------------------------------------------------------------------ //
  //  ダウンロード: ネイティブの「名前を付けて保存」ダイアログを開く
  // ------------------------------------------------------------------ //
  ipcMain.handle('fs:download', async (
    _event,
    { relativePath }: DownloadPayload,
  ) => {
    const fileName = relativePath.split('/').pop() ?? relativePath;
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: fileName,
    });
    if (canceled || !filePath) return;
    fm.downloadFile(relativePath, filePath);
  });

  // ------------------------------------------------------------------ //
  //  アップロード: ネイティブの「ファイルを開く」ダイアログを開く
  // ------------------------------------------------------------------ //
  ipcMain.handle('fs:upload', async (
    _event,
    { destRelativeDir }: UploadPayload,
  ) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return fm.listTree();
    fm.uploadFile(filePaths[0], destRelativeDir);
    return fm.listTree();
  });

  // ------------------------------------------------------------------ //
  //  ユーザー情報: 取得（未登録なら null）
  // ------------------------------------------------------------------ //
  ipcMain.handle('user:get', (): UserConfig | null => {
    try {
      return userFm.readJson(USER_FILE) as UserConfig;
    } catch {
      // ファイル未作成 = 未登録
      return null;
    }
  });

  // ------------------------------------------------------------------ //
  //  ユーザー情報: 保存（新規登録 / 名前変更）
  // ------------------------------------------------------------------ //
  ipcMain.handle('user:save', (_event, { name }: SaveUserPayload): UserConfig => {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('名前を入力してください。');
    }
    const config: UserConfig = { name: trimmed };
    userFm.writeJson(USER_FILE, config);
    return config;
  });
};

// ------------------------------------------------------------------ //
//  起動
// ------------------------------------------------------------------ //
// ------------------------------------------------------------------ //
//  カスタムURLスキーム登録 + 単一インスタンス化（ディープリンク）
// ------------------------------------------------------------------ //
// dev（未パッケージ）では実行パスと引数を明示して登録する
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(URL_SCHEME, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(URL_SCHEME);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // 既に起動中: このインスタンスは終了（URLは既存インスタンスへ渡る）
  app.quit();
} else {
  // 起動中に2つ目が立ち上がった場合（Windows/Linux: argv でURLが渡る）
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((a) => a.startsWith(`${URL_SCHEME}://`));
    if (url) handleDeepLink(url);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // macOS: リンククリックで open-url が発火（起動前でも保留に積む）
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(() => {
    const fm = new FileManager(ROOT_DIR);
    // ユーザー情報は OS のユーザーデータ領域に保存する。
    // ここは NSIS 等でインストールした後でも書き込み可能な領域。
    const userFm = new FileManager(app.getPath('userData'));
    // 記事インデックス。skill/business ラベルは matrix CSV から解決する。
    const matrix = new SkillMatrix(
      path.join(app.getAppPath(), 'matrix', 'uchu_skill_business_map.csv'),
    );
    const am = new ArticleManager(ROOT_DIR, matrix);
    // お気に入りは userData にユーザーごとに保存する
    const favorites = new FavoritesManager(userFm, am);
    registerIpcHandlers(fm, userFm, am, matrix, favorites);
    createWindow();

    // Windows/Linux のコールドスタート: 起動引数にURLがあれば反映
    const startUrl = process.argv.find((a) => a.startsWith(`${URL_SCHEME}://`));
    if (startUrl) handleDeepLink(startUrl);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
