import FileManager from './fileManager';
import ArticleManager from './articleManager';
import type { ToggleFavoriteResult } from '../shared/types';

// お気に入りは userData 配下に保存する（端末ローカル・ユーザーごと）
const FAVORITES_FILE = 'favorites.json';

export default class FavoritesManager {
  private readonly userFm: FileManager;
  private readonly am: ArticleManager;

  constructor(userFm: FileManager, am: ArticleManager) {
    this.userFm = userFm;
    this.am = am;
  }

  private read(): string[] {
    try {
      const data = this.userFm.readJson(FAVORITES_FILE) as { ids?: unknown };
      return Array.isArray(data.ids) ? (data.ids as string[]) : [];
    } catch {
      // 未作成 = お気に入りなし
      return [];
    }
  }

  private write(ids: string[]): void {
    this.userFm.writeJson(FAVORITES_FILE, { ids });
  }

  // 存在しない記事（削除済み）を除外し、変化があれば保存し直す
  private prune(ids: string[]): string[] {
    const valid = ids.filter((id) => this.am.hasArticle(id));
    if (valid.length !== ids.length) this.write(valid);
    return valid;
  }

  // 有効なお気に入りID一覧（プルーニング込み）
  list(): string[] {
    return this.prune(this.read());
  }

  // 登録・解除を切り替える
  toggle(id: string): ToggleFavoriteResult {
    const ids = this.prune(this.read());
    const i = ids.indexOf(id);
    let favorited: boolean;
    if (i >= 0) {
      ids.splice(i, 1);
      favorited = false;
    } else if (this.am.hasArticle(id)) {
      ids.push(id);
      favorited = true;
    } else {
      // 存在しない記事はお気に入りにできない
      favorited = false;
    }
    this.write(ids);
    return { favorited, ids };
  }
}
