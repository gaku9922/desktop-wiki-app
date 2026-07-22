import fs from 'fs';
import path from 'path';
import type {
  Article,
  ArticleDetail,
  ArticleSummary,
  AttachmentRef,
  CreateArticleInput,
  CreateAttachmentInput,
  FileAttachment,
  ResolvedAttachment,
  SkillLabel,
  UpdateArticleInput,
  WikiCategoryNode,
  WikiTreeNode,
} from '../shared/types';
import SkillMatrix from './skillMatrix';
import {
  articleAttachment,
  buildArticleRecord,
  fileServerAttachment,
  inArticleDirAttachment,
  isHttpUrl,
  linkAttachment,
  nowJstIso,
  serializeArticleJson,
  validateCreateInput,
  validateDirName,
  validateUpdateInput,
} from './articleSchema';

// 記事ディレクトリ名（UGB + 数字）
const ARTICLE_DIR_RE = /^UGB\d+$/;
const ID_PREFIX = 'UGB';
const ID_PAD = 4;
// 共有サーバ（外部）パスの存在確認タイムアウト。到達不能でUIを固めないため
const EXTERNAL_TIMEOUT_MS = 2000;

// ------------------------------------------------------------------ //
//  パスの存在確認。外部（共有サーバ）はタイムアウト付き
// ------------------------------------------------------------------ //
async function pathExists(p: string, external: boolean): Promise<boolean> {
  if (!p) return false;
  const check = fs.promises
    .access(p, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false);
  if (!external) return check;
  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => resolve(false), EXTERNAL_TIMEOUT_MS),
  );
  return Promise.race([check, timeout]);
}

// 添付ダウンロードのためにメインへ渡す解決結果
export type DownloadTarget =
  | {
      kind: 'file' | 'folder';
      absPath: string;
      name: string;
      exists: boolean;
      external: boolean;
    }
  | { kind: 'article'; linkedId: string }
  | null;

export default class ArticleManager {
  private readonly rootDir: string;
  private readonly matrix: SkillMatrix;
  private cache: {
    tree: WikiTreeNode[];
    summaries: ArticleSummary[];
    byId: Map<string, ArticleSummary>;
  } | null = null;
  // キーワード検索インデックス（id -> "タイトル\n本文" の小文字）。遅延構築
  private searchCache: Map<string, string> | null = null;

  constructor(rootDir: string, matrix: SkillMatrix) {
    this.rootDir = path.resolve(rootDir);
    this.matrix = matrix;
  }

  // 書き込み・削除後などにキャッシュを無効化する
  invalidate(): void {
    this.cache = null;
    this.searchCache = null;
  }

  getTree(): WikiTreeNode[] {
    return this.ensureIndex().tree;
  }

  getIndex(): ArticleSummary[] {
    return this.ensureIndex().summaries;
  }

  //  記事が存在するか（お気に入りの存在検証などに使用）
  hasArticle(id: string): boolean {
    return this.ensureIndex().byId.has(id);
  }

  // ------------------------------------------------------------------ //
  //  キーワード検索（タイトル＋本文）。初回のみ .md を読み込みキャッシュ
  // ------------------------------------------------------------------ //
  private ensureSearchIndex(): Map<string, string> {
    if (!this.searchCache) {
      const map = new Map<string, string>();
      for (const s of this.ensureIndex().summaries) {
        const body = this.readBody(s);
        map.set(s.id, `${s.title}\n${body}`.toLowerCase());
      }
      this.searchCache = map;
    }
    return this.searchCache;
  }

  //  空白区切りトークンの AND 部分一致（大小文字無視）。updatedAt 降順で返す
  search(query: string): ArticleSummary[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter((t) => t.length > 0);
    const idx = this.ensureSearchIndex();
    const { byId } = this.ensureIndex();
    const results: ArticleSummary[] = [];
    for (const [id, text] of idx) {
      if (tokens.every((t) => text.includes(t))) {
        const s = byId.get(id);
        if (s) results.push(s);
      }
    }
    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return results;
  }

  // ------------------------------------------------------------------ //
  //  インデックス構築（遅延・キャッシュ）
  // ------------------------------------------------------------------ //
  private ensureIndex() {
    if (!this.cache) {
      const summaries: ArticleSummary[] = [];
      const byId = new Map<string, ArticleSummary>();
      const tree = this.walk(this.rootDir, [], summaries, byId);
      this.cache = { tree, summaries, byId };
    }
    return this.cache;
  }

  //  カテゴリディレクトリを再帰走査し、ツリーとサマリを構築する
  private walk(
    absDir: string,
    categoryPath: string[],
    summaries: ArticleSummary[],
    byId: Map<string, ArticleSummary>,
  ): WikiTreeNode[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const nodes: WikiTreeNode[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      const abs = path.join(absDir, name);

      if (ARTICLE_DIR_RE.test(name)) {
        // 記事ディレクトリ。attachments/ は辿らない
        const jsonPath = path.join(abs, `${name}.json`);
        if (!fs.existsSync(jsonPath)) continue;
        let article: Article;
        try {
          article = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Article;
        } catch {
          continue;
        }
        const summary: ArticleSummary = {
          id: article.id ?? name,
          title: article.title ?? name,
          createdAt: article.createdAt ?? '',
          createdBy: article.createdBy ?? '',
          updatedAt: article.updatedAt ?? '',
          updatedBy: article.updatedBy ?? '',
          tags: Array.isArray(article.tags) ? article.tags : [],
          relativePath: this.toRel(jsonPath),
          categoryPath: [...categoryPath],
        };
        summaries.push(summary);
        byId.set(summary.id, summary);
        nodes.push({
          type: 'article',
          id: summary.id,
          title: summary.title,
          relativePath: summary.relativePath,
        });
      } else if (name === 'attachments') {
        // カテゴリ階層に紛れる添付ディレクトリは無視
        continue;
      } else {
        // カテゴリディレクトリ
        const children = this.walk(
          abs,
          [...categoryPath, name],
          summaries,
          byId,
        );
        const category: WikiCategoryNode = {
          type: 'category',
          name,
          path: [...categoryPath, name],
          children,
        };
        nodes.push(category);
      }
    }

    // カテゴリ優先 → 名前順
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'category' ? -1 : 1;
      const an = a.type === 'category' ? a.name : a.title;
      const bn = b.type === 'category' ? b.name : b.title;
      return an.localeCompare(bn, 'ja');
    });
    return nodes;
  }

  private toRel(abs: string): string {
    return path.relative(this.rootDir, abs).split(path.sep).join('/');
  }

  private articleDirOf(summary: ArticleSummary): string {
    // relativePath = .../UGBxxxx/UGBxxxx.json → 記事ディレクトリはその親
    return path.dirname(path.resolve(this.rootDir, summary.relativePath));
  }

  private readArticle(
    id: string,
  ): { article: Article; summary: ArticleSummary } | null {
    const { byId } = this.ensureIndex();
    const summary = byId.get(id);
    if (!summary) return null;
    try {
      const abs = path.resolve(this.rootDir, summary.relativePath);
      const article = JSON.parse(fs.readFileSync(abs, 'utf-8')) as Article;
      return { article, summary };
    } catch {
      return null;
    }
  }

  //  本文の Markdown ファイル（<id>.md）を読む。無ければ空文字にフォールバック
  private readBody(summary: ArticleSummary): string {
    const jsonAbs = path.resolve(this.rootDir, summary.relativePath);
    const mdAbs = jsonAbs.replace(/\.json$/, '.md');
    try {
      return fs.readFileSync(mdAbs, 'utf-8');
    } catch {
      return '';
    }
  }

  // ------------------------------------------------------------------ //
  //  記事詳細（添付の解決メタ・skill/business ラベルを付与）
  // ------------------------------------------------------------------ //
  async getArticleDetail(id: string): Promise<ArticleDetail | null> {
    const found = this.readArticle(id);
    if (!found) return null;
    const { article, summary } = found;
    const { byId } = this.ensureIndex();

    // 本文は別ファイル <id>.md から読み込む（JSON には body を持たない）
    article.body = this.readBody(summary);

    const refs: AttachmentRef[] = Array.isArray(article.attachments)
      ? article.attachments
      : [];
    const attachments: ResolvedAttachment[] = [];
    for (const ref of refs) {
      attachments.push(await this.resolveAttachment(ref, summary, byId));
    }

    const skill: SkillLabel[] = (article.spaceSkill?.skill ?? []).map((sid) => ({
      id: sid,
      label: this.matrix.skillLabel(sid),
    }));
    const business: SkillLabel[] = (article.spaceSkill?.business ?? []).map(
      (bid) => ({ id: bid, label: this.matrix.businessLabel(bid) }),
    );

    return {
      article,
      categoryPath: summary.categoryPath,
      attachments,
      skill,
      business,
    };
  }

  private async resolveAttachment(
    ref: AttachmentRef,
    summary: ArticleSummary,
    byId: Map<string, ArticleSummary>,
  ): Promise<ResolvedAttachment> {
    if (ref.type === 'article') {
      const linked = byId.get(ref.id);
      return {
        kind: 'article',
        method: 'Article',
        displayName: linked?.title ?? ref.id,
        exists: !!linked,
        linkedId: ref.id,
        linkedTitle: linked?.title,
      };
    }
    if (ref.type === 'link') {
      return {
        kind: 'link',
        method: 'externalUrl',
        displayName: ref.name || ref.url,
        exists: isHttpUrl(ref.url), // http/https でなければ無効として警告表示
        url: ref.url,
      };
    }
    const abs = this.attachmentAbsPath(ref, summary);
    const external = ref.method === 'inFileServer';
    const exists = await pathExists(abs, external);
    return {
      kind: ref.type,
      method: ref.method,
      displayName: ref.name,
      ext: ref.ext,
      exists,
      path: abs,
    };
  }

  //  inArticleDir は保存済みパスを信用せず記事ディレクトリから再構築、
  //  inFileServer は保存済み絶対パスをそのまま使う
  private attachmentAbsPath(
    ref: FileAttachment,
    summary: ArticleSummary,
  ): string {
    if (ref.method === 'inArticleDir') {
      return path.join(this.articleDirOf(summary), 'attachments', ref.name);
    }
    return ref.path ?? '';
  }

  private isWithinRoot(abs: string): boolean {
    const resolved = path.resolve(abs);
    return (
      resolved === this.rootDir || resolved.startsWith(this.rootDir + path.sep)
    );
  }

  // ------------------------------------------------------------------ //
  //  添付ダウンロード用の解決。renderer は id + index のみを渡すため、
  //  ここで記事データと突き合わせて実パスを決める（任意パス要求を防ぐ）
  // ------------------------------------------------------------------ //
  async resolveForDownload(
    articleId: string,
    index: number,
  ): Promise<DownloadTarget> {
    const found = this.readArticle(articleId);
    if (!found) return null;
    const refs: AttachmentRef[] = Array.isArray(found.article.attachments)
      ? found.article.attachments
      : [];
    const ref = refs[index];
    if (!ref) return null;
    if (ref.type === 'article') return { kind: 'article', linkedId: ref.id };
    if (ref.type === 'link') return null; // link はダウンロード対象ではない

    const abs = this.attachmentAbsPath(ref, found.summary);
    // inArticleDir は ROOT_DIR 内に封じ込め
    if (ref.method === 'inArticleDir' && !this.isWithinRoot(abs)) return null;
    const external = ref.method === 'inFileServer';
    const exists = await pathExists(abs, external);
    return { kind: ref.type, absPath: abs, name: ref.name, exists, external };
  }

  // ------------------------------------------------------------------ //
  //  外部リンクを開くための解決。renderer は id + index のみを渡すため、
  //  記事データからURLを取り出し http/https のみ許可する（任意URL注入を防ぐ）
  // ------------------------------------------------------------------ //
  resolveLinkForOpen(articleId: string, index: number): { url: string } | null {
    const found = this.readArticle(articleId);
    if (!found) return null;
    const refs: AttachmentRef[] = Array.isArray(found.article.attachments)
      ? found.article.attachments
      : [];
    const ref = refs[index];
    if (!ref || ref.type !== 'link') return null;
    if (!isHttpUrl(ref.url)) return null;
    return { url: ref.url };
  }

  // ファイル: 選択パスへコピー
  async copyFile(src: string, destPath: string): Promise<void> {
    await fs.promises.copyFile(src, destPath);
  }

  // フォルダ: 選択ディレクトリ配下へ「そのまま」再帰コピー（ZIP化しない）
  async copyFolder(src: string, destDir: string): Promise<void> {
    const dest = path.join(destDir, path.basename(src));
    await fs.promises.cp(src, dest, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
  }

  // ================================================================== //
  //  新規記事作成
  // ================================================================== //

  //  既存の最大ID番号をファイルシステムから走査（インデックス陳腐化を避ける）
  private maxExistingIdNum(): number {
    let max = 0;
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const m = /^UGB(\d+)$/.exec(e.name);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > max) max = n;
        } else if (e.name !== 'attachments') {
          walk(path.join(dir, e.name));
        }
      }
    };
    walk(this.rootDir);
    return max;
  }

  private formatId(n: number): string {
    return ID_PREFIX + String(n).padStart(ID_PAD, '0');
  }

  //  カテゴリディレクトリを作成（無ければ）して絶対パスを返す
  private ensureCategoryDir(categoryPath: string[]): string {
    const abs = path.join(this.rootDir, ...categoryPath);
    fs.mkdirSync(abs, { recursive: true });
    return abs;
  }

  //  記事ディレクトリを「衝突したら次ID」で排他的に確保する（共有サーバ対策）
  private allocateArticleDir(categoryAbs: string): { id: string; dir: string } {
    let n = this.maxExistingIdNum() + 1;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const id = this.formatId(n);
      const dir = path.join(categoryAbs, id);
      try {
        fs.mkdirSync(dir); // 既存なら EEXIST で例外 → 次IDへ
        return { id, dir };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          n++;
          continue;
        }
        throw err;
      }
    }
    throw new Error('記事IDの採番に失敗しました。');
  }

  //  添付入力1件を解決して AttachmentRef を作る。uploadは attachments/ へコピー
  private async buildOneAttachment(
    att: CreateAttachmentInput,
    articleDir: string,
  ): Promise<AttachmentRef> {
    switch (att.kind) {
      case 'upload': {
        const attachDir = path.join(articleDir, 'attachments');
        fs.mkdirSync(attachDir, { recursive: true });
        const dest = path.join(attachDir, att.name);
        if (att.fileType === 'folder') {
          await fs.promises.cp(att.sourcePath, dest, {
            recursive: true,
            force: true,
            errorOnExist: false,
          });
        } else {
          await fs.promises.copyFile(att.sourcePath, dest);
        }
        return inArticleDirAttachment(att.name, att.fileType === 'folder', dest);
      }
      case 'fileServer':
        return fileServerAttachment(att.path, att.fileType === 'folder');
      case 'article':
        return articleAttachment(att.id);
      case 'link':
        return linkAttachment(att.url, att.name);
    }
  }

  //  添付入力を解決して AttachmentRef[] を作る
  private async buildAttachments(
    input: CreateArticleInput,
    articleDir: string,
  ): Promise<AttachmentRef[]> {
    const refs: AttachmentRef[] = [];
    for (const att of input.attachments) {
      refs.push(await this.buildOneAttachment(att, articleDir));
    }
    return refs;
  }

  //  新規記事の作成。成功で新IDを返す
  async createArticle(
    input: CreateArticleInput,
    userName: string,
  ): Promise<string> {
    // スキーマ層で一括検証（スキル/業務/記事IDの妥当性を含む）
    const err = validateCreateInput(input, {
      validSkill: (id) => this.matrix.hasSkill(id),
      validBusiness: (id) => this.matrix.hasBusiness(id),
      validArticle: (id) => this.ensureIndex().byId.has(id),
    });
    if (err) throw new Error(err);

    const categoryAbs = this.ensureCategoryDir(input.categoryPath);
    const { id, dir } = this.allocateArticleDir(categoryAbs);

    try {
      const attachments = await this.buildAttachments(input, dir);
      const now = nowJstIso();
      const who = input.anonymous ? '匿名' : userName || '匿名';
      const { json, markdown } = buildArticleRecord({
        id,
        title: input.title.trim(),
        createdAt: now,
        createdBy: who,
        updatedAt: now,
        updatedBy: who,
        tags: input.tags,
        skill: input.skill,
        business: input.business,
        attachments,
        body: input.body,
      });
      fs.writeFileSync(path.join(dir, `${id}.json`), serializeArticleJson(json), 'utf-8');
      fs.writeFileSync(path.join(dir, `${id}.md`), markdown, 'utf-8');
    } catch (e) {
      // 途中失敗は半端な記事を残さないよう作成ディレクトリを撤去
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* cleanup 失敗は無視 */
      }
      throw e;
    }

    this.invalidate();
    return id;
  }

  //  記事を削除する。記事ディレクトリ（json/md/attachments）を丸ごと撤去
  deleteArticle(id: string): void {
    const { byId } = this.ensureIndex();
    const summary = byId.get(id);
    if (!summary) throw new Error('対象の記事が見つかりません。');
    const dir = this.articleDirOf(summary);
    if (!this.isWithinRoot(dir) || dir === this.rootDir) {
      throw new Error('不正なパスです。');
    }
    fs.rmSync(dir, { recursive: true, force: true });
    this.invalidate();
  }

  //  親ディレクトリ配下に新規ディレクトリを作成する
  createDirectory(parentPath: string[], name: string): void {
    const err = validateDirName(name);
    if (err) throw new Error(err);
    const dir = path.join(this.rootDir, ...parentPath, name);
    if (!this.isWithinRoot(dir)) {
      throw new Error('不正なパスです。');
    }
    if (fs.existsSync(dir)) {
      throw new Error('同名のフォルダが既に存在します。');
    }
    fs.mkdirSync(dir, { recursive: true });
    this.invalidate();
  }

  //  既存記事の更新。id/createdAt/createdBy は保持、updated系は更新。
  //  配置先が変わった場合は記事ディレクトリを移動する。
  async updateArticle(
    input: UpdateArticleInput,
    userName: string,
  ): Promise<string> {
    const err = validateUpdateInput(input, {
      validSkill: (id) => this.matrix.hasSkill(id),
      validBusiness: (id) => this.matrix.hasBusiness(id),
      validArticle: (id) => this.ensureIndex().byId.has(id),
    });
    if (err) throw new Error(err);

    const found = this.readArticle(input.id);
    if (!found) throw new Error('対象の記事が見つかりません。');
    const original = found.article;
    const oldDir = this.articleDirOf(found.summary);

    // 配置先変更 → 記事ディレクトリを移動
    let dir = oldDir;
    const oldKey = found.summary.categoryPath.join('/');
    const newKey = input.categoryPath.join('/');
    if (newKey !== oldKey) {
      const targetCategoryAbs = this.ensureCategoryDir(input.categoryPath);
      const newDir = path.join(targetCategoryAbs, input.id);
      if (fs.existsSync(newDir)) {
        throw new Error('移動先に同名の記事が既に存在します。');
      }
      fs.renameSync(oldDir, newDir);
      dir = newDir;
    }

    // 添付の解決（既存維持・新規追加）と inArticleDir で残す名前の収集
    const attachDir = path.join(dir, 'attachments');
    const finalRefs: AttachmentRef[] = [];
    const keptInArticle = new Set<string>();
    for (const item of input.attachments) {
      if (item.source === 'existing') {
        const ref = item.ref;
        if (
          (ref.type === 'file' || ref.type === 'folder') &&
          ref.method === 'inArticleDir'
        ) {
          keptInArticle.add(ref.name);
          finalRefs.push(
            inArticleDirAttachment(
              ref.name,
              ref.type === 'folder',
              path.join(attachDir, ref.name),
            ),
          );
        } else {
          finalRefs.push(ref); // inFileServer / article / link はそのまま
        }
      } else {
        const built = await this.buildOneAttachment(item.input, dir);
        if (built.type !== 'article' && built.method === 'inArticleDir') {
          keptInArticle.add(built.name);
        }
        finalRefs.push(built);
      }
    }

    // 孤児掃除: attachments/ 内で最終的に参照されないファイル/フォルダを削除
    try {
      for (const name of fs.readdirSync(attachDir)) {
        if (!keptInArticle.has(name)) {
          fs.rmSync(path.join(attachDir, name), { recursive: true, force: true });
        }
      }
      if (fs.readdirSync(attachDir).length === 0) fs.rmdirSync(attachDir);
    } catch {
      // attachments/ が無ければ何もしない
    }

    const now = nowJstIso();
    const who = input.anonymous ? '匿名' : userName || '匿名';
    const { json, markdown } = buildArticleRecord({
      id: input.id,
      title: input.title.trim(),
      createdAt: original.createdAt,
      createdBy: original.createdBy,
      updatedAt: now,
      updatedBy: who,
      tags: input.tags,
      skill: input.skill,
      business: input.business,
      attachments: finalRefs,
      body: input.body,
    });
    fs.writeFileSync(path.join(dir, `${input.id}.json`), serializeArticleJson(json), 'utf-8');
    fs.writeFileSync(path.join(dir, `${input.id}.md`), markdown, 'utf-8');

    this.invalidate();
    return input.id;
  }
}
