// ================================================================== //
//  社内Wiki レンダラー（vanilla TS / ハッシュルーター SPA）
// ================================================================== //

//  トップページの説明文（当面はハードコード）
const WIKI_DESCRIPTION =
  '社内Wikiへようこそ。ここは各プロジェクト・技術分野のナレッジを記事として共有・蓄積する場です。' +
  '左のツリーから分類をたどるか、下の最新更新記事から目的の記事を開いてください。';

const LATEST_LIMIT = 30;

// ------------------------------------------------------------------ //
//  DOM 参照
// ------------------------------------------------------------------ //
const treeEl = document.getElementById('tree')!;
const viewEl = document.getElementById('view')!;
const rootBadge = document.getElementById('rootBadge')!;
const refreshBtn = document.getElementById('refreshBtn')!;
const sidebarToggle = document.getElementById('sidebarToggle')!;
const layoutEl = document.getElementById('layout')!;
const homeLink = document.getElementById('homeLink')!;

// ユーザー関連 DOM
const userBadge = document.getElementById('userBadge') as HTMLButtonElement;
const userBadgeName = document.getElementById('userBadgeName')!;
const userModal = document.getElementById('userModal')!;
const userModalTitle = document.getElementById('userModalTitle')!;
const userModalDesc = document.getElementById('userModalDesc')!;
const userNameInput = document.getElementById('userNameInput') as HTMLInputElement;
const userModalError = document.getElementById('userModalError')!;
const userCancelBtn = document.getElementById('userCancelBtn') as HTMLButtonElement;
const userSaveBtn = document.getElementById('userSaveBtn') as HTMLButtonElement;

// ------------------------------------------------------------------ //
//  アプリ状態（インデックスをキャッシュ）
// ------------------------------------------------------------------ //
let wikiTree: WikiTreeNode[] = [];
let articleIndex: ArticleSummary[] = [];
const summaryById = new Map<string, ArticleSummary>();

// ------------------------------------------------------------------ //
//  ユーティリティ
// ------------------------------------------------------------------ //
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ISO 8601 (JST) → "YYYY-MM-DD HH:MM"
function fmtDateTime(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

//  DOM生成ヘルパー（テキストは textContent で安全に設定）
type ElChild = Node | string | null | undefined;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { class?: string; text?: string; title?: string; attrs?: Record<string, string> } = {},
  children: ElChild[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.title) node.title = opts.title;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  for (const c of children) {
    if (c == null) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function showToast(message: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
  const toast = el('div', { class: `toast toast--${kind}`, text: message });
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('toast--visible');
    setTimeout(() => {
      toast.classList.remove('toast--visible');
      toast.addEventListener('transitionend', () => toast.remove());
    }, 2600);
  });
}

function navigate(hash: string): void {
  if (location.hash === hash) render();
  else location.hash = hash;
}

// ------------------------------------------------------------------ //
//  データ読み込み
// ------------------------------------------------------------------ //
async function loadIndex(): Promise<void> {
  [wikiTree, articleIndex] = await Promise.all([
    window.articleAPI.tree(),
    window.articleAPI.index(),
  ]);
  summaryById.clear();
  for (const s of articleIndex) summaryById.set(s.id, s);
}

async function refreshAll(): Promise<void> {
  try {
    await window.articleAPI.refresh();
    await loadIndex();
    renderSidebar();
    render();
    showToast('最新の状態に更新しました');
  } catch (err) {
    showToast(`更新失敗: ${errorMessage(err)}`, 'error');
  }
}

// ------------------------------------------------------------------ //
//  サイドバー（Wikiツリー）
// ------------------------------------------------------------------ //
function renderSidebar(): void {
  treeEl.innerHTML = '';
  if (wikiTree.length === 0) {
    treeEl.appendChild(el('p', { class: 'placeholder', text: '記事がありません' }));
    return;
  }
  treeEl.appendChild(buildTreeList(wikiTree, 0));
  updateSidebarActive();
}

function buildTreeList(nodes: WikiTreeNode[], depth: number): HTMLUListElement {
  const ul = el('ul', { class: 'tree__list' });
  for (const node of nodes) {
    if (node.type === 'category') {
      // 初期状態で全階層折りたたみ
      const startClosed = depth >= 0;
      const li = el('li', { class: 'tree__item tree__item--category' });
      if (startClosed) li.classList.add('tree__item--closed');
      const row = el('div', { class: 'tree__row tree__row--category' });
      row.style.paddingLeft = `${8 + depth * 14}px`;
      const toggle = el('span', { class: 'tree__toggle', text: startClosed ? '▸' : '▾' });
      const icon = el('span', { class: 'tree__icon', text: '📁' });
      const label = el('span', { class: 'tree__label', text: node.name });
      const count = el('span', {
        class: 'tree__count',
        text: String(countArticles(node)),
      });
      row.append(toggle, icon, label, count);

      const children = buildTreeList(node.children, depth + 1);
      children.classList.add('tree__children');

      const toggleOpen = (): void => {
        const closed = li.classList.toggle('tree__item--closed');
        toggle.textContent = closed ? '▸' : '▾';
      };
      // シェブロン = 開閉、ラベル（行本体）= ディレクトリページへ遷移
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleOpen();
      });
      row.addEventListener('click', () => navigate(categoryHash(node.path)));

      li.dataset.categoryPath = node.path.join('/');
      li.append(row, children);
      ul.appendChild(li);
    } else {
      const li = el('li', { class: 'tree__item tree__item--article' });
      const row = el('div', { class: 'tree__row tree__row--article' });
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.dataset.articleId = node.id;
      row.append(
        el('span', { class: 'tree__icon', text: '📄' }),
        el('span', { class: 'tree__label tree__label--article', text: node.title }),
      );
      row.addEventListener('click', () => navigate(`#/article/${node.id}`));
      li.append(row);
      ul.appendChild(li);
    }
  }
  return ul;
}

function countArticles(node: WikiTreeNode): number {
  if (node.type === 'article') return 1;
  return node.children.reduce((n, c) => n + countArticles(c), 0);
}

//  指定したカテゴリパス（およびその祖先）を展開する
function expandPath(path: string[]): void {
  for (let i = 1; i <= path.length; i++) {
    const key = path.slice(0, i).join('/');
    const li = treeEl.querySelector<HTMLElement>(`li[data-category-path="${cssEscape(key)}"]`);
    if (li) {
      li.classList.remove('tree__item--closed');
      const t = li.querySelector<HTMLElement>(':scope > .tree__row--category > .tree__toggle');
      if (t) t.textContent = '▾';
    }
  }
}

//  現在のルートに応じてサイドバーの祖先を展開し、該当行をハイライトする
function updateSidebarActive(): void {
  treeEl.querySelectorAll('.is-active').forEach((r) => r.classList.remove('is-active'));
  const route = parseRoute();

  if (route.type === 'article') {
    const summary = summaryById.get(route.id);
    if (summary) expandPath(summary.categoryPath);
    const row = treeEl.querySelector<HTMLElement>(
      `.tree__row--article[data-article-id="${cssEscape(route.id)}"]`,
    );
    if (row) {
      row.classList.add('is-active');
      row.scrollIntoView({ block: 'nearest' });
    }
  } else if (route.type === 'category') {
    // 祖先のみ展開（自身の開閉はシェブロン操作に委ねる）
    expandPath(route.path.slice(0, -1));
    const li = treeEl.querySelector<HTMLElement>(
      `li[data-category-path="${cssEscape(route.path.join('/'))}"]`,
    );
    const row = li?.querySelector<HTMLElement>(':scope > .tree__row--category');
    if (row) {
      row.classList.add('is-active');
      row.scrollIntoView({ block: 'nearest' });
    }
  }
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

// ------------------------------------------------------------------ //
//  ルーター
// ------------------------------------------------------------------ //
type Route =
  | { type: 'top' }
  | { type: 'article'; id: string }
  | { type: 'category'; path: string[] };

function parseRoute(): Route {
  const h = location.hash;
  const ma = /^#\/article\/(.+)$/.exec(h);
  if (ma) return { type: 'article', id: decodeURIComponent(ma[1]) };
  const mc = /^#\/category\/(.+)$/.exec(h);
  if (mc) return { type: 'category', path: mc[1].split('/').map(decodeURIComponent) };
  return { type: 'top' };
}

function currentArticleId(): string | null {
  const r = parseRoute();
  return r.type === 'article' ? r.id : null;
}

function categoryHash(path: string[]): string {
  return '#/category/' + path.map(encodeURIComponent).join('/');
}

function render(): void {
  const route = parseRoute();
  if (route.type === 'article') renderArticle(route.id);
  else if (route.type === 'category') renderCategory(route.path);
  else renderTop();
  updateSidebarActive();
}

// ------------------------------------------------------------------ //
//  トップページ（説明 + 最新更新記事）
// ------------------------------------------------------------------ //
function renderTop(): void {
  viewEl.innerHTML = '';
  const page = el('div', { class: 'page page--top' });

  page.appendChild(el('h1', { class: 'top__title', text: '社内Wiki' }));
  page.appendChild(el('p', { class: 'top__desc', text: WIKI_DESCRIPTION }));

  const latest = [...articleIndex]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, LATEST_LIMIT);

  page.appendChild(
    el('div', { class: 'section-head' }, [
      el('h2', { class: 'section-title', text: '最新更新記事' }),
      el('span', { class: 'section-sub', text: `全 ${articleIndex.length} 件中 直近 ${latest.length} 件` }),
    ]),
  );

  if (latest.length === 0) {
    page.appendChild(el('p', { class: 'placeholder', text: '記事がありません' }));
  } else {
    const list = el('ul', { class: 'latest-list' });
    for (const s of latest) list.appendChild(latestRow(s));
    page.appendChild(list);
  }

  viewEl.appendChild(page);
}

function latestRow(s: ArticleSummary): HTMLLIElement {
  const li = el('li', { class: 'latest-item' });
  const main = el('div', { class: 'latest-item__main' }, [
    el('span', { class: 'latest-item__title', text: s.title }),
    el('span', { class: 'latest-item__crumb', text: s.categoryPath.join(' / ') || 'ルート' }),
  ]);
  const meta = el('div', { class: 'latest-item__meta' }, [
    el('span', { class: 'latest-item__date', text: `更新 ${fmtDateTime(s.updatedAt)}` }),
    el('span', { class: 'latest-item__author', text: s.author }),
  ]);
  const tags = el('div', { class: 'tag-row' });
  for (const t of s.tags) tags.appendChild(el('span', { class: 'tag', text: t }));

  li.append(main, meta, tags);
  li.addEventListener('click', () => navigate(`#/article/${s.id}`));
  return li;
}

// ------------------------------------------------------------------ //
//  パンくずリスト（トップ + 各カテゴリへのリンク）
// ------------------------------------------------------------------ //
function breadcrumb(path: string[], opts: { lastIsLink: boolean }): HTMLElement {
  const nav = el('nav', { class: 'breadcrumb' });

  const root = el('a', { class: 'breadcrumb__link', text: 'トップ', attrs: { href: '#/' } });
  root.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('#/');
  });
  nav.append(root);

  path.forEach((seg, i) => {
    nav.append(el('span', { class: 'breadcrumb__sep', text: '/' }));
    const isLast = i === path.length - 1;
    if (isLast && !opts.lastIsLink) {
      nav.append(el('span', { class: 'breadcrumb__current', text: seg }));
    } else {
      const prefix = path.slice(0, i + 1);
      const link = el('a', {
        class: 'breadcrumb__link',
        text: seg,
        attrs: { href: categoryHash(prefix) },
      });
      link.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(categoryHash(prefix));
      });
      nav.append(link);
    }
  });
  return nav;
}

// ------------------------------------------------------------------ //
//  ディレクトリ（カテゴリ）閲覧ページ
// ------------------------------------------------------------------ //
function findCategory(path: string[]): WikiCategoryNode | null {
  let nodes: WikiTreeNode[] = wikiTree;
  let found: WikiCategoryNode | null = null;
  for (const seg of path) {
    const next = nodes.find(
      (n): n is WikiCategoryNode => n.type === 'category' && n.name === seg,
    );
    if (!next) return null;
    found = next;
    nodes = next.children;
  }
  return found;
}

function renderCategory(path: string[]): void {
  viewEl.innerHTML = '';
  const node = findCategory(path);
  const page = el('div', { class: 'page page--category' });
  page.appendChild(breadcrumb(path, { lastIsLink: false }));

  if (!node) {
    page.appendChild(el('h1', { class: 'article__title', text: 'ディレクトリが見つかりません' }));
    page.appendChild(el('p', { class: 'placeholder', text: `「${path.join('/')}」は存在しません。` }));
    viewEl.appendChild(page);
    return;
  }

  page.appendChild(el('h1', { class: 'cat__title', text: node.name }));

  const childCategories = node.children.filter(
    (n): n is WikiCategoryNode => n.type === 'category',
  );
  const targetKey = path.join('/');
  const childArticles = articleIndex
    .filter((s) => s.categoryPath.join('/') === targetKey)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // ---- 上: 子ディレクトリ（レスポンシブなカードグリッド）----
  const topSec = el('section', { class: 'cat-section' });
  topSec.append(
    el('div', { class: 'section-head' }, [
      el('h2', { class: 'section-title', text: '子ディレクトリ' }),
      el('span', { class: 'section-sub', text: `${childCategories.length} 件` }),
    ]),
  );
  if (childCategories.length === 0) {
    topSec.append(el('p', { class: 'placeholder', text: '子ディレクトリはありません' }));
  } else {
    const grid = el('div', { class: 'dir-grid' });
    for (const c of childCategories) grid.append(dirCard(c));
    topSec.append(grid);
  }
  page.append(topSec);

  // ---- 下: 子記事（トップの最新更新記事と同じ表示）----
  const botSec = el('section', { class: 'cat-section' });
  botSec.append(
    el('div', { class: 'section-head' }, [
      el('h2', { class: 'section-title', text: '記事' }),
      el('span', { class: 'section-sub', text: `${childArticles.length} 件` }),
    ]),
  );
  if (childArticles.length === 0) {
    botSec.append(el('p', { class: 'placeholder', text: '記事はありません' }));
  } else {
    const list = el('ul', { class: 'latest-list' });
    for (const s of childArticles) list.append(latestRow(s));
    botSec.append(list);
  }
  page.append(botSec);

  viewEl.appendChild(page);
}

function dirCard(c: WikiCategoryNode): HTMLElement {
  const card = el('button', { class: 'dir-card' });
  card.append(
    el('span', { class: 'dir-card__icon', text: '📁' }),
    el('span', { class: 'dir-card__name', text: c.name }),
    el('span', { class: 'dir-card__count', text: `${countArticles(c)} 記事` }),
  );
  card.addEventListener('click', () => navigate(categoryHash(c.path)));
  return card;
}

// ------------------------------------------------------------------ //
//  記事閲覧ページ
// ------------------------------------------------------------------ //
async function renderArticle(id: string): Promise<void> {
  viewEl.innerHTML = '';
  viewEl.appendChild(el('p', { class: 'placeholder', text: '読み込み中…' }));
  let detail: ArticleDetail | null;
  try {
    detail = await window.articleAPI.get(id);
  } catch (err) {
    viewEl.innerHTML = '';
    viewEl.appendChild(el('p', { class: 'placeholder error', text: `読み込み失敗: ${errorMessage(err)}` }));
    return;
  }
  // 遷移中にハッシュが変わっていたら破棄
  if (currentArticleId() !== id) return;

  viewEl.innerHTML = '';
  if (!detail) {
    viewEl.appendChild(notFoundView(id));
    return;
  }

  const a = detail.article;
  const page = el('div', { class: 'page page--article' });

  // パンくず（各カテゴリはディレクトリページへのリンク）
  page.appendChild(breadcrumb(detail.categoryPath, { lastIsLink: true }));

  page.appendChild(el('h1', { class: 'article__title', text: a.title }));

  // メタ
  const meta = el('div', { class: 'article__meta' }, [
    metaItem('著者', a.author),
    metaItem('ID', a.id),
    metaItem('作成', fmtDateTime(a.createdAt)),
    metaItem('更新', fmtDateTime(a.updatedAt)),
  ]);
  page.appendChild(meta);

  // 本文
  page.appendChild(el('div', { class: 'article__body', text: a.body }));

  // タグ
  if (a.tags.length) {
    const tags = el('div', { class: 'tag-row' });
    for (const t of a.tags) tags.appendChild(el('span', { class: 'tag', text: t }));
    page.appendChild(section('タグ', tags));
  }

  // スキル / ビジネス
  if (detail.skill.length) page.appendChild(section('スキル（skill）', labelChips(detail.skill)));
  if (detail.business.length) page.appendChild(section('業務（business）', labelChips(detail.business)));

  // 添付・関連
  page.appendChild(
    section(
      `添付・関連（${detail.attachments.length}）`,
      attachmentList(id, detail.attachments),
    ),
  );

  viewEl.appendChild(page);
}

function notFoundView(id: string): HTMLElement {
  const box = el('div', { class: 'page' });
  box.appendChild(el('h1', { class: 'article__title', text: '記事が見つかりません' }));
  box.appendChild(el('p', { class: 'placeholder', text: `ID「${id}」の記事は存在しません。` }));
  const back = el('button', { class: 'link-btn', text: '← トップへ戻る' });
  back.addEventListener('click', () => navigate('#/'));
  box.appendChild(back);
  return box;
}

function metaItem(label: string, value: string): HTMLElement {
  return el('span', { class: 'meta-item' }, [
    el('span', { class: 'meta-item__label', text: `${label}: ` }),
    el('span', { class: 'meta-item__value', text: value }),
  ]);
}

function section(title: string, body: Node): HTMLElement {
  return el('section', { class: 'article__section' }, [
    el('h3', { class: 'article__section-title', text: title }),
    body,
  ]);
}

function labelChips(items: { id: string; label: string }[]): HTMLElement {
  const wrap = el('div', { class: 'chip-row' });
  for (const it of items) {
    wrap.appendChild(
      el('span', { class: 'chip' }, [
        el('span', { class: 'chip__id', text: it.id }),
        el('span', { class: 'chip__label', text: it.label }),
      ]),
    );
  }
  return wrap;
}

// ------------------------------------------------------------------ //
//  添付リスト
// ------------------------------------------------------------------ //
const METHOD_BADGE: Record<string, { text: string; cls: string }> = {
  inArticleDir: { text: '記事内', cls: 'badge--in' },
  inFileServer: { text: 'サーバ参照', cls: 'badge--server' },
  Article: { text: '関連記事', cls: 'badge--article' },
};

function attachmentList(articleId: string, atts: ResolvedAttachment[]): HTMLElement {
  const wrap = el('div', { class: 'attach-list' });
  if (atts.length === 0) {
    wrap.appendChild(el('p', { class: 'placeholder', text: '添付ファイルはありません' }));
    return wrap;
  }
  atts.forEach((att, index) => {
    const broken = !att.exists;
    const row = el('div', {
      class: `attach-row${broken ? ' attach-row--broken' : ''}`,
    });

    const icon = el('span', { class: 'attach-row__icon', text: attachIcon(att) });
    const name = el('span', { class: 'attach-row__name', text: att.displayName });

    const badgeInfo = METHOD_BADGE[att.method];
    const badge = el('span', { class: `badge ${badgeInfo.cls}`, text: badgeInfo.text });

    row.append(icon, name, badge);

    if (broken) {
      row.append(el('span', { class: 'attach-row__warn', text: '⚠ パス切れ' }));
    }

    row.addEventListener('click', () => onAttachmentClick(articleId, index, att));
    wrap.appendChild(row);
  });
  return wrap;
}

function attachIcon(att: ResolvedAttachment): string {
  if (att.kind === 'article') return '🔗';
  if (att.kind === 'folder') return '📁';
  return '📄';
}

async function onAttachmentClick(
  articleId: string,
  index: number,
  att: ResolvedAttachment,
): Promise<void> {
  // 関連記事 → 遷移
  if (att.kind === 'article') {
    if (att.exists && att.linkedId) navigate(`#/article/${att.linkedId}`);
    else showToast('関連記事が見つかりません（リンク切れ）', 'warn');
    return;
  }
  // パス切れ → 警告（DLは試みない）
  if (!att.exists) {
    showToast(`パスが切れています: ${att.path ?? att.displayName}`, 'warn');
    return;
  }
  // ファイル / フォルダ → ダウンロード
  try {
    const result: AttachDownloadResult = await window.articleAPI.downloadAttachment(articleId, index);
    switch (result.status) {
      case 'ok':
        showToast(att.kind === 'folder' ? 'フォルダをコピーしました' : 'ダウンロードしました');
        break;
      case 'missing':
        showToast(`パスが切れています: ${result.path}`, 'warn');
        break;
      case 'error':
        showToast(`取得失敗: ${result.message}`, 'error');
        break;
      case 'canceled':
      default:
        break;
    }
  } catch (err) {
    showToast(`取得失敗: ${errorMessage(err)}`, 'error');
  }
}

// ------------------------------------------------------------------ //
//  ユーザー登録 / 名前変更
// ------------------------------------------------------------------ //
function renderUserBadge(name: string): void {
  userBadgeName.textContent = name;
  userBadge.hidden = false;
}

function openUserModal(currentName: string, required: boolean): void {
  userModalError.textContent = '';
  userNameInput.value = currentName;
  if (required) {
    userModalTitle.textContent = 'ようこそ';
    userModalDesc.textContent = 'お名前を登録してください。';
    userSaveBtn.textContent = '登録';
    userCancelBtn.hidden = true;
  } else {
    userModalTitle.textContent = '名前の変更';
    userModalDesc.textContent = '新しいお名前を入力してください。';
    userSaveBtn.textContent = '保存';
    userCancelBtn.hidden = false;
  }
  userModal.hidden = false;
  userNameInput.focus();
  userNameInput.select();
}

function closeUserModal(): void {
  userModal.hidden = true;
}

async function submitUserName(): Promise<void> {
  userModalError.textContent = '';
  const name = userNameInput.value.trim();
  if (!name) {
    userModalError.textContent = '名前を入力してください。';
    return;
  }
  try {
    const saved = await window.userAPI.save(name);
    renderUserBadge(saved.name);
    closeUserModal();
    showToast('名前を保存しました');
  } catch (err) {
    userModalError.textContent = `保存失敗: ${errorMessage(err)}`;
  }
}

userSaveBtn.addEventListener('click', submitUserName);
userNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitUserName();
});
userCancelBtn.addEventListener('click', closeUserModal);
userBadge.addEventListener('click', () => openUserModal(userBadgeName.textContent ?? '', false));

async function initUser(): Promise<void> {
  try {
    const user = await window.userAPI.get();
    if (user) renderUserBadge(user.name);
    else openUserModal('', true);
  } catch {
    openUserModal('', true);
  }
}

// ------------------------------------------------------------------ //
//  グローバルなイベント・初期化
// ------------------------------------------------------------------ //
refreshBtn.addEventListener('click', refreshAll);
homeLink.addEventListener('click', () => navigate('#/'));
sidebarToggle.addEventListener('click', () => layoutEl.classList.toggle('layout--sidebar-hidden'));
window.addEventListener('hashchange', render);

(async () => {
  try {
    const rootDir = await window.fileAPI.getRootDir();
    rootBadge.textContent = rootDir;
    rootBadge.title = rootDir;
  } catch {
    rootBadge.textContent = '(パス取得失敗)';
  }
  try {
    await loadIndex();
    renderSidebar();
    render();
  } catch (err) {
    treeEl.innerHTML = '';
    treeEl.appendChild(el('p', { class: 'placeholder error', text: `取得失敗: ${errorMessage(err)}` }));
  }
  initUser();
})();
