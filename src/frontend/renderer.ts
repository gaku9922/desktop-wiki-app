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
let matrixOptions: MatrixOptions | null = null;
let currentUserName = '';

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
      // シェブロン = 開閉、ラベル（行本体）= フォルダページへ遷移
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
  | { type: 'category'; path: string[] }
  | { type: 'new'; path: string[] };

function parseRoute(): Route {
  const h = location.hash;
  const ma = /^#\/article\/(.+)$/.exec(h);
  if (ma) return { type: 'article', id: decodeURIComponent(ma[1]) };
  const mc = /^#\/category\/(.+)$/.exec(h);
  if (mc) return { type: 'category', path: mc[1].split('/').map(decodeURIComponent) };
  const mn = /^#\/new(?:\/(.+))?$/.exec(h);
  if (mn) return { type: 'new', path: mn[1] ? mn[1].split('/').map(decodeURIComponent) : [] };
  return { type: 'top' };
}

function currentArticleId(): string | null {
  const r = parseRoute();
  return r.type === 'article' ? r.id : null;
}

function categoryHash(path: string[]): string {
  return '#/category/' + path.map(encodeURIComponent).join('/');
}

function newHash(path: string[]): string {
  return '#/new' + (path.length ? '/' + path.map(encodeURIComponent).join('/') : '');
}

function newArticleButton(targetPath: string[]): HTMLElement {
  const btn = el('button', { class: 'btn btn--primary', text: '＋ 新規記事作成' });
  btn.addEventListener('click', () => navigate(newHash(targetPath)));
  return btn;
}

function render(): void {
  const route = parseRoute();
  if (route.type === 'article') renderArticle(route.id);
  else if (route.type === 'category') renderCategory(route.path);
  else if (route.type === 'new') renderNew(route.path);
  else renderTop();
  updateSidebarActive();
}

// ------------------------------------------------------------------ //
//  トップページ（説明 + 最新更新記事）
// ------------------------------------------------------------------ //
function renderTop(): void {
  viewEl.innerHTML = '';
  const page = el('div', { class: 'page page--top' });

  const head = el('div', { class: 'page__toolbar' }, [
    el('h1', { class: 'top__title', text: '社内Wiki' }),
    newArticleButton([]),
  ]);
  page.appendChild(head);
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
    el('span', { class: 'latest-item__author', text: s.updatedBy }),
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
//  フォルダ（カテゴリ）閲覧ページ
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
    page.appendChild(el('h1', { class: 'article__title', text: 'フォルダが見つかりません' }));
    page.appendChild(el('p', { class: 'placeholder', text: `「${path.join('/')}」は存在しません。` }));
    viewEl.appendChild(page);
    return;
  }

  page.appendChild(
    el('div', { class: 'page__toolbar' }, [
      el('h1', { class: 'cat__title', text: node.name }),
      el('div', { class: 'toolbar-actions' }, [folderCreateButton(path), newArticleButton(path)]),
    ]),
  );

  const childCategories = node.children.filter(
    (n): n is WikiCategoryNode => n.type === 'category',
  );
  const targetKey = path.join('/');
  const childArticles = articleIndex
    .filter((s) => s.categoryPath.join('/') === targetKey)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // ---- 子フォルダと子記事を同一リストに（エクスプローラ風）----
  //  並び順: フォルダが先、その後に記事
  if (childCategories.length === 0 && childArticles.length === 0) {
    page.append(el('p', { class: 'placeholder', text: '空のフォルダです' }));
    viewEl.appendChild(page);
    return;
  }

  const list = el('ul', { class: 'latest-list' });
  for (const c of childCategories) list.append(dirRow(c));
  for (const s of childArticles) list.append(latestRow(s));
  page.append(list);

  viewEl.appendChild(page);
}

//  フォルダ行（フォルダアイコン + 名前 + 記事数）。記事行と同じ一覧に並ぶ
function dirRow(c: WikiCategoryNode): HTMLLIElement {
  const li = el('li', { class: 'latest-item latest-item--dir' });
  const left = el('span', { class: 'dir-row__left' }, [
    el('span', { class: 'dir-row__icon', text: '📁' }),
    el('span', { class: 'dir-row__name', text: c.name }),
  ]);
  const count = el('span', { class: 'dir-row__count', text: `${countArticles(c)} 記事` });
  li.append(left, count);
  li.addEventListener('click', () => navigate(categoryHash(c.path)));
  return li;
}

//  「＋ 新規フォルダ作成」ボタン。押下でフォルダ名入力ポップアップを開く
function folderCreateButton(parentPath: string[]): HTMLElement {
  const btn = el('button', { class: 'btn', text: '＋ 新規フォルダ作成' });
  btn.addEventListener('click', () => openFolderCreateModal(parentPath));
  return btn;
}

//  フォルダ名入力のポップアップ（モーダル）
function openFolderCreateModal(parentPath: string[]): void {
  const input = document.createElement('input');
  input.className = 'form-input';
  input.placeholder = 'フォルダ名';
  const err = el('p', { class: 'editor-error' });
  const cancel = el('button', { class: 'btn', text: 'キャンセル' });
  const create = el('button', { class: 'btn btn--primary', text: '作成' });

  const overlay = el('div', { class: 'modal-overlay' }, [
    el('div', { class: 'modal-card' }, [
      el('h2', { class: 'modal-title', text: '新規フォルダ作成' }),
      el('p', {
        class: 'modal-desc',
        text: `「${parentPath.join(' / ') || 'ルート'}」の直下に作成します。`,
      }),
      el('label', { class: 'form-label' }, ['フォルダ名', input]),
      err,
      el('div', { class: 'modal-actions' }, [cancel, create]),
    ]),
  ]);

  const close = (): void => overlay.remove();
  const submit = async (): Promise<void> => {
    err.textContent = '';
    const name = input.value.trim();
    if (!name) {
      err.textContent = 'フォルダ名を入力してください。';
      return;
    }
    create.setAttribute('disabled', 'true');
    try {
      const result = await window.articleAPI.createDirectory(parentPath, name);
      if (result.status === 'ok') {
        close();
        await window.articleAPI.refresh();
        await loadIndex();
        renderSidebar();
        render();
        showToast('フォルダを作成しました');
      } else {
        err.textContent = result.message;
        create.removeAttribute('disabled');
      }
    } catch (e) {
      err.textContent = errorMessage(e);
      create.removeAttribute('disabled');
    }
  };
  cancel.addEventListener('click', close);
  create.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    else if (e.key === 'Escape') close();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  document.body.appendChild(overlay);
  input.focus();
}

// ================================================================== //
//  新規記事作成ページ
// ================================================================== //
function flattenCategories(
  nodes: WikiTreeNode[],
  acc: { path: string[]; label: string }[] = [],
): { path: string[]; label: string }[] {
  for (const n of nodes) {
    if (n.type === 'category') {
      acc.push({ path: n.path, label: n.path.join(' / ') });
      flattenCategories(n.children, acc);
    }
  }
  return acc;
}

function allTags(): string[] {
  const s = new Set<string>();
  for (const a of articleIndex) for (const t of a.tags) s.add(t);
  return [...s].sort((a, b) => a.localeCompare(b, 'ja'));
}

//  絶対パスの拡張子有無から file/folder を推定（フォーム側の初期値）
function guessPathType(raw: string): 'file' | 'folder' {
  let s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  s = s.trim();
  const parts = s.split(/[/\\]+/).filter(Boolean);
  const base = parts.length ? parts[parts.length - 1] : s;
  const dot = base.lastIndexOf('.');
  return dot > 0 && dot < base.length - 1 ? 'file' : 'folder';
}

async function renderNew(initialPath: string[]): Promise<void> {
  viewEl.innerHTML = '';
  viewEl.appendChild(el('p', { class: 'placeholder', text: '読み込み中…' }));
  if (!matrixOptions) {
    try {
      matrixOptions = await window.articleAPI.matrixOptions();
    } catch {
      matrixOptions = { skills: [], business: [] };
    }
  }
  if (parseRoute().type !== 'new') return;
  viewEl.innerHTML = '';

  const page = el('div', { class: 'page page--form' });
  page.appendChild(el('h1', { class: 'article__title', text: '新規記事作成' }));

  // ---- 配置先フォルダ ----
  const cats = flattenCategories(wikiTree);
  const dirSelect = document.createElement('select');
  dirSelect.className = 'form-select';
  dirSelect.appendChild(el('option', { text: 'ルート（wiki 直下）', attrs: { value: '' } }));
  for (const c of cats) {
    dirSelect.appendChild(el('option', { text: c.label, attrs: { value: c.path.join('/') } }));
  }
  dirSelect.value = initialPath.join('/');
  page.appendChild(
    field('配置先フォルダ', [
      dirSelect,
      el('div', { class: 'field__hint', text: '既存フォルダから選択してください（新規フォルダはフォルダページから作成できます）。' }),
    ]),
  );

  // ---- 作成者・匿名 ----
  const anon = document.createElement('input');
  anon.type = 'checkbox';
  const authorLabel = el('span', { class: 'author-name', text: currentUserName || '(未登録)' });
  const updateAuthor = (): void => {
    authorLabel.textContent = anon.checked ? '匿名' : currentUserName || '(未登録)';
  };
  anon.addEventListener('change', updateAuthor);
  const anonLabel = el('label', { class: 'checkbox' }, [anon, document.createTextNode(' 匿名で作成する')]);
  page.appendChild(
    field('作成者 / 最終更新者', [
      el('div', { class: 'author-line' }, [authorLabel, anonLabel]),
      el('div', { class: 'field__hint', text: '作成時は最終更新者も作成者と同じになります。' }),
    ]),
  );

  // ---- タイトル ----
  const titleInput = document.createElement('input');
  titleInput.className = 'form-input';
  titleInput.placeholder = '記事タイトル';
  page.appendChild(field('タイトル（必須）', [titleInput]));

  // ---- 本文 ----
  const bodyInput = document.createElement('textarea');
  bodyInput.className = 'form-textarea';
  bodyInput.rows = 10;
  bodyInput.placeholder = '本文（プレーンテキスト。1文字以上必須）';
  page.appendChild(field('本文（必須）', [bodyInput]));

  // ---- タグ ----
  const selectedTags: string[] = [];
  page.appendChild(tagField(selectedTags));

  // ---- スキル / 業務 ----
  const selectedSkill: string[] = [];
  const selectedBusiness: string[] = [];
  page.appendChild(multiSelectField('スキル（skill）', matrixOptions.skills, selectedSkill));
  page.appendChild(multiSelectField('業務（business）', matrixOptions.business, selectedBusiness));

  // ---- 添付（追加済みは一覧に残る。複数・任意の組み合わせ可）----
  const attachments: CreateAttachmentInput[] = [];
  page.appendChild(attachmentsField(attachments));

  // ---- 送信 ----
  const errorEl = el('p', { class: 'editor-error' });
  const submit = el('button', { class: 'btn btn--primary', text: '作成' });
  const cancel = el('button', { class: 'btn', text: 'キャンセル' });
  cancel.addEventListener('click', () =>
    navigate(initialPath.length ? categoryHash(initialPath) : '#/'),
  );
  submit.addEventListener('click', async () => {
    errorEl.textContent = '';
    const selectedDir = dirSelect.value ? dirSelect.value.split('/') : [];
    const input: CreateArticleInput = {
      categoryPath: selectedDir,
      title: titleInput.value.trim(),
      body: bodyInput.value,
      anonymous: anon.checked,
      tags: selectedTags,
      skill: selectedSkill,
      business: selectedBusiness,
      attachments,
    };
    if (!input.title) {
      errorEl.textContent = 'タイトルを入力してください。';
      return;
    }
    if (!input.body.trim()) {
      errorEl.textContent = '本文を入力してください（1文字以上）。';
      return;
    }
    submit.setAttribute('disabled', 'true');
    try {
      const result = await window.articleAPI.createArticle(input);
      if (result.status === 'ok') {
        await loadIndex();
        renderSidebar();
        showToast('記事を作成しました');
        navigate(`#/article/${result.id}`);
      } else {
        errorEl.textContent = `作成失敗: ${result.message}`;
        submit.removeAttribute('disabled');
      }
    } catch (err) {
      errorEl.textContent = `作成失敗: ${errorMessage(err)}`;
      submit.removeAttribute('disabled');
    }
  });
  page.appendChild(errorEl);
  page.appendChild(el('div', { class: 'form-actions' }, [cancel, submit]));

  viewEl.appendChild(page);
}

//  フォームの1フィールド（ラベル＋中身）
function field(labelText: string, children: (Node | string)[]): HTMLElement {
  return el('div', { class: 'field' }, [
    el('label', { class: 'field__label', text: labelText }),
    ...children,
  ]);
}

function tagField(selected: string[]): HTMLElement {
  const chips = el('div', { class: 'chips' });
  const input = document.createElement('input');
  input.className = 'form-input';
  input.placeholder = 'タグを入力して Enter（既存タグはサジェスト）';
  const dl = document.createElement('datalist');
  dl.id = 'tag-suggest';
  for (const t of allTags()) dl.appendChild(el('option', { attrs: { value: t } }));
  input.setAttribute('list', 'tag-suggest');
  const renderChips = (): void => {
    chips.innerHTML = '';
    for (const t of selected) chips.appendChild(removableChip(t, () => {
      const i = selected.indexOf(t);
      if (i >= 0) selected.splice(i, 1);
      renderChips();
    }));
  };
  const add = (): void => {
    const v = input.value.trim();
    if (v && !selected.includes(v)) {
      selected.push(v);
      renderChips();
    }
    input.value = '';
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    }
  });
  return field('タグ', [input, dl, chips]);
}

function multiSelectField(
  labelText: string,
  options: MatrixOption[],
  selected: string[],
): HTMLElement {
  const sel = document.createElement('select');
  sel.className = 'form-select';
  fillMatrixSelect(sel, options);
  const chips = el('div', { class: 'chips' });
  const labelOf = (id: string): string => options.find((o) => o.id === id)?.label ?? id;
  const renderChips = (): void => {
    chips.innerHTML = '';
    for (const id of selected) {
      chips.appendChild(removableChip(`${id} ${labelOf(id)}`, () => {
        const i = selected.indexOf(id);
        if (i >= 0) selected.splice(i, 1);
        renderChips();
      }));
    }
  };
  sel.addEventListener('change', () => {
    const v = sel.value;
    if (v && !selected.includes(v)) {
      selected.push(v);
      renderChips();
    }
    sel.value = '';
  });
  return field(labelText, [sel, chips]);
}

function fillMatrixSelect(sel: HTMLSelectElement, options: MatrixOption[]): void {
  sel.appendChild(el('option', { text: '選択して追加…', attrs: { value: '' } }));
  const groups = new Map<string, { label: string; items: MatrixOption[] }>();
  for (const o of options) {
    if (!groups.has(o.majorId)) groups.set(o.majorId, { label: o.majorLabel, items: [] });
    groups.get(o.majorId)!.items.push(o);
  }
  for (const g of groups.values()) {
    const og = document.createElement('optgroup');
    og.label = g.label;
    for (const o of g.items) {
      og.appendChild(el('option', { text: `${o.id}  ${o.label}`, attrs: { value: o.id } }));
    }
    sel.appendChild(og);
  }
}

function removableChip(text: string, onRemove: () => void): HTMLElement {
  const chip = el('span', { class: 'chip-sel' }, [el('span', { text })]);
  const x = el('button', { class: 'chip-sel__x', text: '×', title: '削除' });
  x.addEventListener('click', onRemove);
  chip.appendChild(x);
  return chip;
}

// ---- 添付: 追加済み一覧 ＋ 追加エリア ----
//  追加した添付は committed に蓄積され一覧に残る（方式プルダウンの変更に影響されない）。
//  どの方式でも複数・任意の組み合わせで追加できる。
function attachmentsField(committed: CreateAttachmentInput[]): HTMLElement {
  const wrap = el('div', { class: 'field' });
  wrap.appendChild(el('label', { class: 'field__label', text: '添付' }));

  const list = el('div', { class: 'attach-list' });
  const renderList = (): void => {
    list.innerHTML = '';
    if (committed.length === 0) {
      list.appendChild(el('p', { class: 'field__hint', text: 'まだ添付はありません。' }));
      return;
    }
    committed.forEach((att, i) => {
      list.appendChild(
        committedAttachRow(att, () => {
          committed.splice(i, 1);
          renderList();
        }),
      );
    });
  };

  const adder = buildAttachAdder((att) => {
    committed.push(att);
    renderList();
  });

  wrap.append(list, adder);
  renderList();
  return wrap;
}

const ATTACH_BADGE: Record<CreateAttachmentInput['kind'], { text: string; cls: string }> = {
  upload: { text: '記事内', cls: 'badge--in' },
  fileServer: { text: 'サーバ参照', cls: 'badge--server' },
  article: { text: '関連記事', cls: 'badge--article' },
  link: { text: '外部リンク', cls: 'badge--link' },
};

//  追加済み添付の1行表示（削除可）
function committedAttachRow(att: CreateAttachmentInput, onRemove: () => void): HTMLElement {
  let icon = '📄';
  let name = '';
  if (att.kind === 'upload') {
    icon = att.fileType === 'folder' ? '📁' : '📄';
    name = att.name;
  } else if (att.kind === 'fileServer') {
    icon = att.fileType === 'folder' ? '📁' : '📄';
    name = att.path;
  } else if (att.kind === 'article') {
    icon = '🔗';
    const t = summaryById.get(att.id)?.title;
    name = t ? `${t}（${att.id}）` : att.id;
  } else {
    icon = '🌐';
    name = att.name || att.url;
  }
  const badge = ATTACH_BADGE[att.kind];
  const row = el('div', { class: 'attach-row' }, [
    el('span', { class: 'attach-row__icon', text: icon }),
    el('span', { class: 'attach-row__name', text: name }),
    el('span', { class: `badge ${badge.cls}`, text: badge.text }),
  ]);
  const x = el('button', { class: 'chip-sel__x', text: '×', title: '削除' });
  x.addEventListener('click', onRemove);
  row.append(x);
  return row;
}

//  追加エリア（方式選択＋入力＋追加）。ここの操作は一覧の既存項目に影響しない
function buildAttachAdder(onAdd: (att: CreateAttachmentInput) => void): HTMLElement {
  const box = el('div', { class: 'attach-adder' });
  const method = document.createElement('select');
  method.className = 'form-select';
  const methods: [CreateAttachmentInput['kind'], string][] = [
    ['upload', 'ファイルアップロード'],
    ['fileServer', 'ファイルサーバ絶対パス'],
    ['article', '他記事'],
    ['link', '外部リンク'],
  ];
  for (const [v, t] of methods) method.appendChild(el('option', { text: t, attrs: { value: v } }));

  const detail = el('div', { class: 'attach-adder__detail' });
  const rebuild = (): void => {
    detail.innerHTML = '';
    detail.appendChild(buildAdderDetail(method.value as CreateAttachmentInput['kind'], onAdd));
  };
  method.addEventListener('change', rebuild);

  box.append(
    el('div', { class: 'attach-adder__head' }, [
      el('span', { class: 'field__hint', text: '添付を追加:' }),
      method,
    ]),
    detail,
  );
  rebuild();
  return box;
}

function buildAdderDetail(
  kind: CreateAttachmentInput['kind'],
  onAdd: (att: CreateAttachmentInput) => void,
): HTMLElement {
  const box = el('div');

  if (kind === 'upload') {
    const hint = el('span', { class: 'field__hint', text: 'ファイル / フォルダを選ぶとそのまま一覧に追加されます。' });
    const pick = async (mode: 'file' | 'folder'): Promise<void> => {
      const res = await window.articleAPI.pickPath(mode);
      if (res) onAdd({ kind: 'upload', sourcePath: res.path, fileType: res.kind, name: res.name });
    };
    const fileBtn = el('button', { class: 'btn', text: 'ファイル選択して追加' });
    fileBtn.addEventListener('click', () => pick('file'));
    const folderBtn = el('button', { class: 'btn', text: 'フォルダ選択して追加' });
    folderBtn.addEventListener('click', () => pick('folder'));
    box.append(el('div', { class: 'row-inline' }, [fileBtn, folderBtn]), hint);
    return box;
  }

  if (kind === 'fileServer') {
    const pathInput = document.createElement('input');
    pathInput.className = 'form-input';
    pathInput.placeholder = '絶対パス（例: //bvd120/共有/資料.pdf）';
    let fsType: 'file' | 'folder' = 'file';
    let touched = false;
    const fileRadio = radio('fsType-' + Math.random(), 'ファイル');
    const folderRadio = radio(fileRadio.name, 'フォルダ');
    const applyType = (t: 'file' | 'folder'): void => {
      fsType = t;
      fileRadio.input.checked = t === 'file';
      folderRadio.input.checked = t === 'folder';
    };
    applyType('file');
    pathInput.addEventListener('input', () => {
      if (!touched) applyType(guessPathType(pathInput.value));
    });
    fileRadio.input.addEventListener('change', () => {
      touched = true;
      applyType('file');
    });
    folderRadio.input.addEventListener('change', () => {
      touched = true;
      applyType('folder');
    });
    const addBtn = el('button', { class: 'btn', text: '追加' });
    addBtn.addEventListener('click', () => {
      const v = pathInput.value.trim();
      if (!v) {
        showToast('パスを入力してください', 'warn');
        return;
      }
      onAdd({ kind: 'fileServer', path: v, fileType: fsType });
      pathInput.value = '';
      touched = false;
      applyType('file');
    });
    box.append(
      pathInput,
      el('div', { class: 'row-inline' }, [
        el('span', { class: 'field__hint', text: '種別:' }),
        fileRadio.label,
        folderRadio.label,
        addBtn,
      ]),
      el('div', { class: 'warn-text', text: '※ 参照先が移動・削除されるとリンク切れになります。ご注意ください。' }),
    );
    return box;
  }

  if (kind === 'article') {
    const input = document.createElement('input');
    input.className = 'form-input';
    input.placeholder = '記事IDまたはタイトルで検索';
    const dl = document.createElement('datalist');
    dl.id = 'art-suggest-' + Math.random().toString(36).slice(2);
    for (const s of articleIndex) {
      dl.appendChild(el('option', { attrs: { value: `${s.id}  ${s.title}` } }));
    }
    input.setAttribute('list', dl.id);
    const resolved = el('span', { class: 'field__hint' });
    const currentId = (): string => {
      const m = /(UGB\d+)/.exec(input.value);
      return m ? m[1] : '';
    };
    const sync = (): void => {
      const id = currentId();
      const t = id ? summaryById.get(id)?.title : undefined;
      resolved.textContent = id ? (t ? `→ ${t}` : '→ 該当記事が見つかりません') : '';
    };
    input.addEventListener('input', sync);
    const addBtn = el('button', { class: 'btn', text: '追加' });
    addBtn.addEventListener('click', () => {
      const id = currentId();
      if (!id || !summaryById.has(id)) {
        showToast('有効な記事を選択してください', 'warn');
        return;
      }
      onAdd({ kind: 'article', id });
      input.value = '';
      sync();
    });
    box.append(input, dl, el('div', { class: 'row-inline' }, [resolved, addBtn]));
    return box;
  }

  // link
  const url = document.createElement('input');
  url.className = 'form-input';
  url.placeholder = 'https://example.com/...';
  const name = document.createElement('input');
  name.className = 'form-input';
  name.placeholder = '表示名（任意）';
  const addBtn = el('button', { class: 'btn', text: '追加' });
  addBtn.addEventListener('click', () => {
    const u = url.value.trim();
    if (!isHttpUrlFront(u)) {
      showToast('http / https のURLを入力してください', 'warn');
      return;
    }
    onAdd({ kind: 'link', url: u, name: name.value.trim() || undefined });
    url.value = '';
    name.value = '';
  });
  box.append(url, name, el('div', { class: 'row-inline' }, [addBtn]));
  return box;
}

function isHttpUrlFront(u: string): boolean {
  try {
    const proto = new URL(u).protocol;
    return proto === 'http:' || proto === 'https:';
  } catch {
    return false;
  }
}

function radio(name: string, labelText: string): { input: HTMLInputElement; label: HTMLElement; name: string } {
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  const label = el('label', { class: 'radio' }, [input, document.createTextNode(' ' + labelText)]);
  return { input, label, name };
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

  // パンくず（各カテゴリはフォルダページへのリンク）
  page.appendChild(breadcrumb(detail.categoryPath, { lastIsLink: true }));

  page.appendChild(el('h1', { class: 'article__title', text: a.title }));

  // メタ（作成日＋作成者 / 更新日＋更新者 をそれぞれ並べる。折り返し可）
  const meta = el('div', { class: 'article__meta' }, [
    metaItem('ID', a.id),
    metaItem('作成', `${fmtDateTime(a.createdAt)} ・ ${a.createdBy}`),
    metaItem('更新', `${fmtDateTime(a.updatedAt)} ・ ${a.updatedBy}`),
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
  externalUrl: { text: '外部リンク', cls: 'badge--link' },
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
    // 外部リンクはホバーでURLを表示
    if (att.kind === 'link' && att.url) row.title = att.url;

    const icon = el('span', { class: 'attach-row__icon', text: attachIcon(att) });
    const name = el('span', { class: 'attach-row__name', text: att.displayName });

    const badgeInfo = METHOD_BADGE[att.method];
    const badge = el('span', { class: `badge ${badgeInfo.cls}`, text: badgeInfo.text });

    row.append(icon, name, badge);

    if (broken) {
      const warnText = att.kind === 'link' ? '⚠ 無効なリンク' : '⚠ パス切れ';
      row.append(el('span', { class: 'attach-row__warn', text: warnText }));
    }

    row.addEventListener('click', () => onAttachmentClick(articleId, index, att));
    wrap.appendChild(row);
  });
  return wrap;
}

function attachIcon(att: ResolvedAttachment): string {
  if (att.kind === 'article') return '🔗';
  if (att.kind === 'link') return '🌐';
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
  // 外部リンク → 既定ブラウザで開く（http/https のみ）
  if (att.kind === 'link') {
    if (!att.exists) {
      showToast('無効なリンクです（http / https のみ対応）', 'warn');
      return;
    }
    try {
      const result = await window.articleAPI.openLink(articleId, index);
      if (result.status === 'ok') showToast('ブラウザで開きました');
      else if (result.status === 'invalid') showToast('無効なリンクです（http / https のみ対応）', 'warn');
      else showToast(`リンクを開けません: ${result.message}`, 'error');
    } catch (err) {
      showToast(`リンクを開けません: ${errorMessage(err)}`, 'error');
    }
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
  currentUserName = name;
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
