import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import dotenv from 'dotenv';
import FileManager from './fileManager';
import ArticleManager from './articleManager';
import SkillMatrix from './skillMatrix';
import type {
  ArticleGetPayload,
  AttachDownloadPayload,
  AttachDownloadResult,
  DeletePayload,
  DownloadPayload,
  OpenLinkPayload,
  OpenLinkResult,
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
};

// ------------------------------------------------------------------ //
//  IPC ハンドラ登録
// ------------------------------------------------------------------ //
const registerIpcHandlers = (
  fm: FileManager,
  userFm: FileManager,
  am: ArticleManager,
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
  registerIpcHandlers(fm, userFm, am);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
