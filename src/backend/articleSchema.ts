import type {
  ArticleAttachment,
  AttachmentRef,
  CreateArticleInput,
  FileAttachment,
  LinkAttachment,
} from '../shared/types';

// ================================================================== //
//  記事JSONスキーマの単一の真実源（Single Source of Truth）
//  - 検証 / 正規化 / タイムスタンプ / 添付の構築 / レコード組立を集約
//  - 大きな機能側にスキーマ知識を散らさないための層
// ================================================================== //

// ------------------------------------------------------------------ //
//  文字列ユーティリティ
// ------------------------------------------------------------------ //

//  外部リンクは http / https のみ許可
export function isHttpUrl(url: string): boolean {
  try {
    const proto = new URL(url).protocol;
    return proto === 'http:' || proto === 'https:';
  } catch {
    return false;
  }
}

//  絶対パスの正規化: 前後空白と、前後を囲む1組のダブルクォートを除去
//  （Windowsの「パスとしてコピー」は "…" で囲まれるため両対応）
export function normalizeAbsolutePath(input: string): string {
  let s = input.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

//  パスの basename（/ と \ の両方で分割 → Windows/UNC 対応）
export function baseName(p: string): string {
  const parts = p.split(/[/\\]+/).filter((seg) => seg.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

//  拡張子（先頭以外の . 以降）。無ければ空文字
export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1);
  return '';
}

//  フォルダ名の妥当性。OKなら null、NGならメッセージ
//  禁止: < > : " / \ | ? * と制御文字。ハイフン・空白・日本語は許可（HTV-X 等の既存名を通す）
// eslint-disable-next-line no-control-regex
const FORBIDDEN_DIR_CHARS = /[<>:"/\\|?*]/;
export function validateDirName(name: string): string | null {
  if (!name || name.trim().length === 0) return 'フォルダ名が空です。';
  if (name !== name.trim()) return 'フォルダ名の前後に空白は使えません。';
  if (name === '.' || name === '..') return `"${name}" はフォルダ名に使えません。`;
  if (FORBIDDEN_DIR_CHARS.test(name)) {
    return `フォルダ名に使用できない文字が含まれています: ${name}`;
  }
  if (name.endsWith('.')) return 'フォルダ名の末尾に "." は使えません。';
  return null;
}

// ------------------------------------------------------------------ //
//  タイムスタンプ: ホストTZに依存せず JST(+09:00) の ISO 8601 を生成
// ------------------------------------------------------------------ //
export function nowJstIso(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())}` +
    `T${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}:${p(jst.getUTCSeconds())}+09:00`
  );
}

// ------------------------------------------------------------------ //
//  添付 AttachmentRef の構築（内部キー順もここで固定）
// ------------------------------------------------------------------ //
export function inArticleDirAttachment(
  name: string,
  isFolder: boolean,
  absPath: string,
): FileAttachment {
  const a: FileAttachment = {
    type: isFolder ? 'folder' : 'file',
    method: 'inArticleDir',
    path: absPath,
    name,
  };
  if (!isFolder) a.ext = extOf(name);
  return a;
}

export function fileServerAttachment(rawPath: string, isFolder: boolean): FileAttachment {
  const p = normalizeAbsolutePath(rawPath);
  const name = baseName(p);
  const a: FileAttachment = {
    type: isFolder ? 'folder' : 'file',
    method: 'inFileServer',
    path: p,
    name,
  };
  if (!isFolder) a.ext = extOf(name);
  return a;
}

export function articleAttachment(id: string): ArticleAttachment {
  return { type: 'article', method: 'Article', id };
}

export function linkAttachment(url: string, name?: string): LinkAttachment {
  const a: LinkAttachment = { type: 'link', method: 'externalUrl', url };
  if (name && name.trim()) a.name = name.trim();
  return a;
}

// ------------------------------------------------------------------ //
//  入力検証（新規作成）
// ------------------------------------------------------------------ //
export interface CreateValidators {
  validSkill(id: string): boolean;
  validBusiness(id: string): boolean;
  validArticle(id: string): boolean;
}

export function validateCreateInput(
  input: CreateArticleInput,
  v: CreateValidators,
): string | null {
  if (!input.title || input.title.trim().length === 0) {
    return 'タイトルを入力してください。';
  }
  if (!input.body || input.body.trim().length === 0) {
    return '本文を入力してください（1文字以上）。';
  }
  for (const seg of input.categoryPath) {
    const err = validateDirName(seg);
    if (err) return err;
  }
  for (const id of input.skill) {
    if (!v.validSkill(id)) return `不正なスキルIDです: ${id}`;
  }
  for (const id of input.business) {
    if (!v.validBusiness(id)) return `不正な業務IDです: ${id}`;
  }
  for (const att of input.attachments) {
    switch (att.kind) {
      case 'upload':
        if (!att.sourcePath) return 'アップロード対象が選択されていません。';
        if (!att.name) return 'アップロードファイル名が不正です。';
        break;
      case 'fileServer':
        if (normalizeAbsolutePath(att.path).length === 0) {
          return 'ファイルサーバのパスを入力してください。';
        }
        break;
      case 'article':
        if (!att.id) return '関連記事が選択されていません。';
        if (!v.validArticle(att.id)) return `存在しない記事IDです: ${att.id}`;
        break;
      case 'link':
        if (!isHttpUrl(att.url)) return `無効なURLです（http/https のみ）: ${att.url}`;
        break;
    }
  }
  return null;
}

// ------------------------------------------------------------------ //
//  記事レコードの組立（JSON本体 + 本文Markdown）。キー順もここで固定
// ------------------------------------------------------------------ //
export interface BuildRecordParams {
  id: string;
  title: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  tags: string[];
  skill: string[];
  business: string[];
  attachments: AttachmentRef[];
  body: string;
}

export function buildArticleRecord(
  params: BuildRecordParams,
): { json: Record<string, unknown>; markdown: string } {
  const json: Record<string, unknown> = {
    id: params.id,
    title: params.title,
    createdAt: params.createdAt,
    createdBy: params.createdBy,
    updatedAt: params.updatedAt,
    updatedBy: params.updatedBy,
    attachments: params.attachments,
    tags: params.tags,
    spaceSkill: { business: params.business, skill: params.skill },
  };
  return { json, markdown: params.body };
}

//  記事JSONの直列化（既存Wikiデータと同じ 4スペースインデント）
export function serializeArticleJson(json: Record<string, unknown>): string {
  return JSON.stringify(json, null, 4);
}
