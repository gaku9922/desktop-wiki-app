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
const searchKeyword = document.getElementById('searchKeyword') as HTMLInputElement;
const searchTag = document.getElementById('searchTag') as HTMLSelectElement;
const sidebarEl = document.getElementById('sidebar')!;
const sidebarResizer = document.getElementById('sidebarResizer')!;
const favoritesEl = document.getElementById('favorites')!;

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
let matrixData: MatrixData | null = null;
let favoriteIds = new Set<string>();
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
    await loadFavorites();
    renderSidebar();
    renderFavorites();
    populateSearchControls();
    render();
    showToast('最新の状態に更新しました');
  } catch (err) {
    showToast(`更新失敗: ${errorMessage(err)}`, 'error');
  }
}

// ------------------------------------------------------------------ //
//  お気に入り
// ------------------------------------------------------------------ //
async function loadFavorites(): Promise<void> {
  try {
    favoriteIds = new Set(await window.favAPI.list());
  } catch {
    favoriteIds = new Set();
  }
}

function isFavorite(id: string): boolean {
  return favoriteIds.has(id);
}

//  サイドバーのお気に入り一覧を描画（存在する記事のみ）
function renderFavorites(): void {
  favoritesEl.innerHTML = '';
  const ids = [...favoriteIds].filter((id) => summaryById.has(id));
  if (ids.length === 0) {
    favoritesEl.appendChild(
      el('p', { class: 'placeholder placeholder--sm', text: 'お気に入りはありません' }),
    );
    return;
  }
  for (const id of ids) {
    const s = summaryById.get(id)!;
    const row = el('div', { class: 'fav-row', title: s.title }, [
      el('span', { class: 'fav-row__icon', text: '★' }),
      el('span', { class: 'fav-row__title', text: s.title }),
    ]);
    row.addEventListener('click', () => navigate(`#/article/${id}`));
    favoritesEl.appendChild(row);
  }
}

//  お気に入りをトグルし、状態・サイドバーを更新
async function toggleFavorite(id: string): Promise<boolean> {
  const result = await window.favAPI.toggle(id);
  favoriteIds = new Set(result.ids);
  renderFavorites();
  return result.favorited;
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
  | { type: 'new'; path: string[] }
  | { type: 'edit'; id: string }
  | { type: 'search'; mode: 'kw' | 'tag'; term: string }
  | { type: 'skillmatrix' };

function parseRoute(): Route {
  const h = location.hash;
  const ma = /^#\/article\/(.+)$/.exec(h);
  if (ma) return { type: 'article', id: decodeURIComponent(ma[1]) };
  const mc = /^#\/category\/(.+)$/.exec(h);
  if (mc) return { type: 'category', path: mc[1].split('/').map(decodeURIComponent) };
  const mn = /^#\/new(?:\/(.+))?$/.exec(h);
  if (mn) return { type: 'new', path: mn[1] ? mn[1].split('/').map(decodeURIComponent) : [] };
  const me = /^#\/edit\/(.+)$/.exec(h);
  if (me) return { type: 'edit', id: decodeURIComponent(me[1]) };
  const msr = /^#\/search\/(kw|tag)\/(.+)$/.exec(h);
  if (msr) return { type: 'search', mode: msr[1] as 'kw' | 'tag', term: decodeURIComponent(msr[2]) };
  if (h === '#/skillmatrix') return { type: 'skillmatrix' };
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

function editHash(id: string): string {
  return '#/edit/' + encodeURIComponent(id);
}

function searchHash(mode: 'kw' | 'tag', term: string): string {
  return `#/search/${mode}/${encodeURIComponent(term)}`;
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
  else if (route.type === 'edit') renderEdit(route.id);
  else if (route.type === 'search') renderSearch(route.mode, route.term);
  else if (route.type === 'skillmatrix') renderSkillMatrix();
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

// ------------------------------------------------------------------ //
//  検索結果ページ
// ------------------------------------------------------------------ //
async function renderSearch(mode: 'kw' | 'tag', term: string): Promise<void> {
  viewEl.innerHTML = '';
  viewEl.appendChild(el('p', { class: 'placeholder', text: '検索中…' }));

  let results: ArticleSummary[];
  let label: string;
  if (mode === 'kw') {
    try {
      results = await window.articleAPI.search(term);
    } catch (err) {
      viewEl.innerHTML = '';
      viewEl.appendChild(el('p', { class: 'placeholder error', text: `検索失敗: ${errorMessage(err)}` }));
      return;
    }
    // 検索中にルートが変わっていたら破棄
    const r = parseRoute();
    if (r.type !== 'search' || r.mode !== 'kw' || r.term !== term) return;
    label = `キーワード「${term}」`;
  } else {
    results = articleIndex
      .filter((s) => s.tags.includes(term))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    label = `タグ「${term}」`;
  }

  viewEl.innerHTML = '';
  const page = el('div', { class: 'page page--search' });
  page.appendChild(el('h1', { class: 'top__title', text: '検索結果' }));
  page.appendChild(
    el('div', { class: 'section-head' }, [
      el('span', { class: 'section-title', text: label }),
      el('span', { class: 'section-sub', text: `${results.length} 件` }),
    ]),
  );
  if (results.length === 0) {
    page.appendChild(el('p', { class: 'placeholder', text: '該当する記事がありません。' }));
  } else {
    const list = el('ul', { class: 'latest-list' });
    for (const s of results) list.appendChild(latestRow(s));
    page.appendChild(list);
  }
  viewEl.appendChild(page);
}

//  タグ検索プルダウンを全タグで埋める（選択状態は保持）
function populateSearchControls(): void {
  const current = searchTag.value;
  searchTag.innerHTML = '';
  searchTag.appendChild(el('option', { text: 'タグで検索…', attrs: { value: '' } }));
  for (const t of allTags()) {
    searchTag.appendChild(el('option', { text: t, attrs: { value: t } }));
  }
  searchTag.value = current;
}

// ------------------------------------------------------------------ //
//  宇宙スキル標準マトリクス
// ------------------------------------------------------------------ //
async function renderSkillMatrix(): Promise<void> {
  viewEl.innerHTML = '';
  viewEl.appendChild(el('p', { class: 'placeholder', text: '読み込み中…' }));
  if (!matrixData) {
    try {
      matrixData = await window.articleAPI.matrixFull();
    } catch {
      matrixData = { businessMajors: [], skillMajors: [], links: [] };
    }
  }
  if (parseRoute().type !== 'skillmatrix') return;
  const data = matrixData;

  // 逆引き用: biz -> skill -> level、id -> label、skill大項目 -> subIds
  const linkMap = new Map<string, Map<string, number>>();
  for (const l of data.links) {
    let m = linkMap.get(l.b);
    if (!m) {
      m = new Map();
      linkMap.set(l.b, m);
    }
    m.set(l.s, l.level);
  }
  const subLabel = new Map<string, string>();
  const subDesc = new Map<string, string>();
  const skillMajorSubs = new Map<string, string[]>();
  for (const sm of data.skillMajors) {
    skillMajorSubs.set(sm.id, sm.subs.map((s) => s.id));
    for (const s of sm.subs) {
      subLabel.set(s.id, s.label);
      if (s.desc) subDesc.set(s.id, s.desc);
    }
  }
  const bizMajorSubs = new Map<string, string[]>();
  for (const bm of data.businessMajors) {
    bizMajorSubs.set(bm.id, bm.subs.map((s) => s.id));
    for (const s of bm.subs) {
      subLabel.set(s.id, s.label);
      if (s.desc) subDesc.set(s.id, s.desc);
    }
  }

  const maxLevel = (bizIds: string[], skillIds: string[]): number => {
    let max = 0;
    for (const b of bizIds) {
      const m = linkMap.get(b);
      if (!m) continue;
      for (const s of skillIds) {
        const lv = m.get(s);
        if (lv && lv > max) {
          max = lv;
          if (max >= 2) return 2;
        }
      }
    }
    return max;
  };

  const expandedBiz = new Set<string>();
  const expandedSkill = new Set<string>();
  let selected: { kind: 'business' | 'skill'; id: string } | null = null;

  viewEl.innerHTML = '';
  const page = el('div', { class: 'page page--skillmatrix' });
  page.appendChild(el('h1', { class: 'top__title', text: '宇宙スキル標準' }));
  page.appendChild(
    el('p', {
      class: 'top__desc',
      text:
        '行=業務・列=スキルのマトリクスです。大項目をクリックで小項目を展開し、' +
        '小項目（業務・スキル）を選択すると関連する記事が表示されます。',
    }),
  );
  // 出典
  const citeUrl = 'https://www8.cao.go.jp/space/skill/kaisai.html';
  const citeLink = el('a', {
    class: 'source-cite__link',
    text: '宇宙スキル標準について:宇宙政策 - 内閣府',
    title: citeUrl,
    attrs: { href: citeUrl },
  });
  citeLink.addEventListener('click', (e) => {
    e.preventDefault();
    window.articleAPI.openExternalUrl(citeUrl);
  });
  page.appendChild(
    el('p', { class: 'source-cite' }, [el('span', { text: '出典: ' }), citeLink]),
  );

  const matrixWrap = el('div', { class: 'matrix-wrap' });
  const panel = el('div', { class: 'matrix-panel' });

  const rebuildMatrix = (): void => {
    matrixWrap.innerHTML = '';
    matrixWrap.appendChild(buildMatrixTable());
  };
  const rebuildPanel = (): void => {
    panel.innerHTML = '';
    panel.appendChild(buildRelatedPanel());
  };

  function buildMatrixTable(): HTMLElement {
    const table = document.createElement('table');
    table.className = 'matrix-table';

    // 列エントリ（スキル）を平坦化
    const colEntries: { major: string; sub: string | null }[] = [];
    for (const sm of data.skillMajors) {
      if (expandedSkill.has(sm.id)) {
        for (const s of sm.subs) colEntries.push({ major: sm.id, sub: s.id });
      } else {
        colEntries.push({ major: sm.id, sub: null });
      }
    }

    // ヘッダー行1: スキル大項目バンド
    const thead = document.createElement('thead');
    const hr1 = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'matrix-corner';
    corner.colSpan = 2;
    corner.rowSpan = 2;
    hr1.appendChild(corner);
    for (const sm of data.skillMajors) {
      const expanded = expandedSkill.has(sm.id);
      const th = document.createElement('th');
      th.className = 'matrix-cmajor';
      th.colSpan = expanded ? sm.subs.length : 1;
      th.textContent = `${sm.label} ${expanded ? '▾' : '▸'}`;
      th.title = 'クリックで展開/折りたたみ';
      th.addEventListener('click', () => {
        if (expanded) expandedSkill.delete(sm.id);
        else expandedSkill.add(sm.id);
        rebuildMatrix();
      });
      hr1.appendChild(th);
    }
    thead.appendChild(hr1);

    // ヘッダー行2: スキル小項目（展開時のみ・縦書き）
    const hr2 = document.createElement('tr');
    for (const sm of data.skillMajors) {
      if (expandedSkill.has(sm.id)) {
        for (const s of sm.subs) {
          const th = document.createElement('th');
          th.className = 'matrix-csub';
          if (selected && selected.kind === 'skill' && selected.id === s.id) {
            th.classList.add('is-selected');
          }
          th.appendChild(el('span', { class: 'matrix-csub__label', text: s.label }));
          th.title = `${s.id} ${s.label}`;
          th.addEventListener('click', () => selectItem('skill', s.id));
          hr2.appendChild(th);
        }
      } else {
        const th = document.createElement('th');
        th.className = 'matrix-csub matrix-csub--collapsed';
        hr2.appendChild(th);
      }
    }
    thead.appendChild(hr2);
    table.appendChild(thead);

    // ボディ: 業務行
    const tbody = document.createElement('tbody');
    for (const bm of data.businessMajors) {
      const expanded = expandedBiz.has(bm.id);
      const rowEntries = expanded
        ? bm.subs.map((s) => ({ sub: s.id as string | null, label: s.label }))
        : [{ sub: null as string | null, label: bm.label }];
      rowEntries.forEach((re, idx) => {
        const tr = document.createElement('tr');
        if (idx === 0) {
          const rmajor = document.createElement('th');
          rmajor.className = 'matrix-rmajor';
          rmajor.rowSpan = expanded ? bm.subs.length : 1;
          rmajor.textContent = `${bm.label} ${expanded ? '▾' : '▸'}`;
          rmajor.title = 'クリックで展開/折りたたみ';
          rmajor.addEventListener('click', () => {
            if (expanded) expandedBiz.delete(bm.id);
            else expandedBiz.add(bm.id);
            rebuildMatrix();
          });
          tr.appendChild(rmajor);
        }
        const rsub = document.createElement('th');
        if (re.sub) {
          rsub.className = 'matrix-rsub';
          if (selected && selected.kind === 'business' && selected.id === re.sub) {
            rsub.classList.add('is-selected');
          }
          rsub.textContent = re.label;
          const sid = re.sub;
          rsub.addEventListener('click', () => selectItem('business', sid));
        } else {
          rsub.className = 'matrix-rsub matrix-rsub--collapsed';
        }
        tr.appendChild(rsub);

        const rowSkills = re.sub ? [re.sub] : bmSubs(bm.id);
        for (const ce of colEntries) {
          const td = document.createElement('td');
          td.className = 'matrix-cell';
          const colSkills = ce.sub ? [ce.sub] : skillMajorSubs.get(ce.major) ?? [];
          const lv = maxLevel(rowSkills, colSkills);
          if (lv >= 2) td.classList.add('matrix-cell--lv2');
          else if (lv === 1) td.classList.add('matrix-cell--lv1');
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      });
    }
    table.appendChild(tbody);
    return table;
  }

  function bmSubs(majorId: string): string[] {
    return bizMajorSubs.get(majorId) ?? [];
  }

  function selectItem(kind: 'business' | 'skill', id: string): void {
    selected = { kind, id };
    rebuildMatrix();
    rebuildPanel();
    panel.scrollIntoView({ block: 'nearest' });
  }

  function buildRelatedPanel(): HTMLElement {
    const box = el('div', { class: 'related' });
    if (!selected) {
      box.appendChild(
        el('p', {
          class: 'placeholder',
          text: 'マトリクスの小項目（業務・スキル）を選択すると、関連する記事が表示されます。',
        }),
      );
      return box;
    }
    const label = subLabel.get(selected.id) ?? selected.id;
    if (selected.kind === 'business') {
      box.appendChild(el('h2', { class: 'related__title', text: `業務: ${label}（${selected.id}）` }));
      const bdesc = subDesc.get(selected.id);
      if (bdesc) box.appendChild(el('p', { class: 'related__desc', text: bdesc }));
      box.appendChild(relatedSection('この業務に紐づく記事', articlesByBusiness(selected.id)));
      // 関連スキルとその記事
      const skillIds = data.links
        .filter((l) => l.b === selected!.id)
        .map((l) => l.s);
      const uniqSkills = [...new Set(skillIds)];
      const skillsHead = el('h3', { class: 'related__subhead', text: `関連するスキル（${uniqSkills.length}）とその記事` });
      box.appendChild(skillsHead);
      if (uniqSkills.length === 0) {
        box.appendChild(el('p', { class: 'placeholder placeholder--sm', text: '関連スキルはありません' }));
      } else {
        for (const sk of uniqSkills) {
          box.appendChild(
            relatedSection(`スキル: ${subLabel.get(sk) ?? sk}（${sk}）`, articlesBySkill(sk), true),
          );
        }
      }
    } else {
      box.appendChild(el('h2', { class: 'related__title', text: `スキル: ${label}（${selected.id}）` }));
      const sdesc = subDesc.get(selected.id);
      if (sdesc) box.appendChild(el('p', { class: 'related__desc', text: sdesc }));
      box.appendChild(relatedSection('このスキルに紐づく記事', articlesBySkill(selected.id)));
      const bizIds = data.links
        .filter((l) => l.s === selected!.id)
        .map((l) => l.b);
      const uniqBiz = [...new Set(bizIds)];
      box.appendChild(el('h3', { class: 'related__subhead', text: `関連する業務（${uniqBiz.length}）とその記事` }));
      if (uniqBiz.length === 0) {
        box.appendChild(el('p', { class: 'placeholder placeholder--sm', text: '関連業務はありません' }));
      } else {
        for (const bz of uniqBiz) {
          box.appendChild(
            relatedSection(`業務: ${subLabel.get(bz) ?? bz}（${bz}）`, articlesByBusiness(bz), true),
          );
        }
      }
    }
    return box;
  }

  page.append(matrixWrap, panel);
  viewEl.appendChild(page);
  rebuildMatrix();
  rebuildPanel();
}

function articlesByBusiness(id: string): ArticleSummary[] {
  return articleIndex
    .filter((s) => s.business.includes(id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function articlesBySkill(id: string): ArticleSummary[] {
  return articleIndex
    .filter((s) => s.skill.includes(id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

//  関連記事の1グループ（見出し＋記事リンク一覧）
function relatedSection(title: string, articles: ArticleSummary[], sub = false): HTMLElement {
  const wrap = el('div', { class: sub ? 'related__group related__group--sub' : 'related__group' });
  wrap.appendChild(el('div', { class: 'related__group-title', text: `${title} ・ ${articles.length}件` }));
  if (articles.length === 0) {
    wrap.appendChild(el('p', { class: 'placeholder placeholder--sm', text: '記事はありません' }));
    return wrap;
  }
  const list = el('div', { class: 'related__list' });
  for (const s of articles) {
    const row = el('div', { class: 'related__row' }, [
      el('span', { class: 'related__row-title', text: s.title }),
      el('span', { class: 'related__row-crumb', text: s.categoryPath.join(' / ') || 'ルート' }),
    ]);
    row.addEventListener('click', () => navigate(`#/article/${s.id}`));
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
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
        populateSearchControls();
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

//  確認ポップアップ（ツーアクション）。OKで onConfirm を実行
function openConfirmModal(opts: {
  title: string;
  message: string;
  confirmText?: string;
  onConfirm: () => void;
}): void {
  const cancel = el('button', { class: 'btn', text: 'キャンセル' });
  const ok = el('button', { class: 'btn btn--danger', text: opts.confirmText ?? '削除' });
  const overlay = el('div', { class: 'modal-overlay' }, [
    el('div', { class: 'modal-card' }, [
      el('h2', { class: 'modal-title', text: opts.title }),
      el('p', { class: 'modal-desc', text: opts.message }),
      el('div', { class: 'modal-actions' }, [cancel, ok]),
    ]),
  ]);
  const close = (): void => overlay.remove();
  cancel.addEventListener('click', close);
  ok.addEventListener('click', () => {
    close();
    opts.onConfirm();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  ok.focus();
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

interface FormInit {
  mode: 'create' | 'edit';
  articleId?: string;
  initialCategoryPath: string[];
  title: string;
  body: string;
  tags: string[];
  skill: string[];
  business: string[];
  attachments: EditAttachmentInput[];
}

async function ensureMatrixOptions(): Promise<void> {
  if (!matrixOptions) {
    try {
      matrixOptions = await window.articleAPI.matrixOptions();
    } catch {
      matrixOptions = { skills: [], business: [] };
    }
  }
}

//  新規作成 / 編集で共通のフォーム
function buildForm(init: FormInit): void {
  if (!matrixOptions) return;
  const isEdit = init.mode === 'edit';
  viewEl.innerHTML = '';

  const page = el('div', { class: 'page page--form' });
  page.appendChild(
    el('h1', { class: 'article__title', text: isEdit ? '記事の編集' : '新規記事作成' }),
  );

  // ---- 配置先フォルダ ----
  const cats = flattenCategories(wikiTree);
  const dirSelect = document.createElement('select');
  dirSelect.className = 'form-select';
  dirSelect.appendChild(el('option', { text: 'ルート（wiki 直下）', attrs: { value: '' } }));
  for (const c of cats) {
    dirSelect.appendChild(el('option', { text: c.label, attrs: { value: c.path.join('/') } }));
  }
  dirSelect.value = init.initialCategoryPath.join('/');
  page.appendChild(
    field('配置先フォルダ', [
      dirSelect,
      el('div', {
        class: 'field__hint',
        text: isEdit
          ? 'フォルダを変更すると記事が移動します。'
          : '既存フォルダから選択してください（新規フォルダはフォルダページから作成できます）。',
      }),
    ]),
  );

  // ---- 作成者 / 更新者・匿名 ----
  const anon = document.createElement('input');
  anon.type = 'checkbox';
  const authorLabel = el('span', { class: 'author-name', text: currentUserName || '(未登録)' });
  const updateAuthor = (): void => {
    authorLabel.textContent = anon.checked ? '匿名' : currentUserName || '(未登録)';
  };
  anon.addEventListener('change', updateAuthor);
  const anonLabel = el('label', { class: 'checkbox' }, [
    anon,
    document.createTextNode(isEdit ? ' 匿名で更新する' : ' 匿名で作成する'),
  ]);
  page.appendChild(
    field(isEdit ? '最終更新者' : '作成者 / 最終更新者', [
      el('div', { class: 'author-line' }, [authorLabel, anonLabel]),
      el('div', {
        class: 'field__hint',
        text: isEdit
          ? '更新すると最終更新者が記録されます（作成者・作成日は変更されません）。'
          : '作成時は最終更新者も作成者と同じになります。',
      }),
    ]),
  );

  // ---- タイトル ----
  const titleInput = document.createElement('input');
  titleInput.className = 'form-input';
  titleInput.placeholder = '記事タイトル';
  titleInput.value = init.title;
  page.appendChild(field('タイトル（必須）', [titleInput]));

  // ---- 本文 ----
  const bodyInput = document.createElement('textarea');
  bodyInput.className = 'form-textarea';
  bodyInput.rows = 10;
  bodyInput.placeholder = '本文（プレーンテキスト。1文字以上必須）';
  bodyInput.value = init.body;
  page.appendChild(field('本文（必須）', [bodyInput]));

  // ---- タグ ----
  const selectedTags: string[] = [...init.tags];
  page.appendChild(tagField(selectedTags));

  // ---- 宇宙スキル標準（スキル / 業務を内包）----
  const selectedSkill: string[] = [...init.skill];
  const selectedBusiness: string[] = [...init.business];
  page.appendChild(
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: '宇宙スキル標準' }),
      el('div', { class: 'space-skill' }, [
        multiSelectField('スキル（skill）', matrixOptions.skills, selectedSkill),
        multiSelectField('業務（business）', matrixOptions.business, selectedBusiness),
      ]),
    ]),
  );

  // ---- 添付（既存＋新規追加を一覧で保持）----
  const attachments: EditAttachmentInput[] = [...init.attachments];
  page.appendChild(attachmentsField(attachments));

  // ---- 送信 ----
  const errorEl = el('p', { class: 'editor-error' });
  const submit = el('button', { class: 'btn btn--primary', text: isEdit ? '更新' : '作成' });
  const cancel = el('button', { class: 'btn', text: 'キャンセル' });
  const cancelTarget =
    isEdit && init.articleId
      ? `#/article/${init.articleId}`
      : init.initialCategoryPath.length
        ? categoryHash(init.initialCategoryPath)
        : '#/';
  cancel.addEventListener('click', () => navigate(cancelTarget));

  submit.addEventListener('click', async () => {
    errorEl.textContent = '';
    const selectedDir = dirSelect.value ? dirSelect.value.split('/') : [];
    const title = titleInput.value.trim();
    const body = bodyInput.value;
    if (!title) {
      errorEl.textContent = 'タイトルを入力してください。';
      return;
    }
    if (!body.trim()) {
      errorEl.textContent = '本文を入力してください（1文字以上）。';
      return;
    }
    submit.setAttribute('disabled', 'true');
    const verb = isEdit ? '更新' : '作成';
    try {
      let result: CreateArticleResult | UpdateArticleResult;
      if (isEdit && init.articleId) {
        result = await window.articleAPI.updateArticle({
          id: init.articleId,
          categoryPath: selectedDir,
          title,
          body,
          anonymous: anon.checked,
          tags: selectedTags,
          skill: selectedSkill,
          business: selectedBusiness,
          attachments,
        });
      } else {
        const newInputs = attachments
          .filter(
            (a): a is Extract<EditAttachmentInput, { source: 'new' }> =>
              a.source === 'new',
          )
          .map((a) => a.input);
        result = await window.articleAPI.createArticle({
          categoryPath: selectedDir,
          title,
          body,
          anonymous: anon.checked,
          tags: selectedTags,
          skill: selectedSkill,
          business: selectedBusiness,
          attachments: newInputs,
        });
      }
      if (result.status === 'ok') {
        await window.articleAPI.refresh();
        await loadIndex();
        renderSidebar();
        renderFavorites();
        populateSearchControls();
        showToast(`記事を${verb}しました`);
        navigate(`#/article/${result.id}`);
      } else {
        errorEl.textContent = `${verb}失敗: ${result.message}`;
        submit.removeAttribute('disabled');
      }
    } catch (err) {
      errorEl.textContent = `${verb}失敗: ${errorMessage(err)}`;
      submit.removeAttribute('disabled');
    }
  });
  page.appendChild(errorEl);
  page.appendChild(el('div', { class: 'form-actions' }, [cancel, submit]));

  viewEl.appendChild(page);
}

async function renderNew(initialPath: string[]): Promise<void> {
  viewEl.innerHTML = '';
  viewEl.appendChild(el('p', { class: 'placeholder', text: '読み込み中…' }));
  await ensureMatrixOptions();
  if (parseRoute().type !== 'new') return;
  buildForm({
    mode: 'create',
    initialCategoryPath: initialPath,
    title: '',
    body: '',
    tags: [],
    skill: [],
    business: [],
    attachments: [],
  });
}

async function renderEdit(id: string): Promise<void> {
  viewEl.innerHTML = '';
  viewEl.appendChild(el('p', { class: 'placeholder', text: '読み込み中…' }));
  await ensureMatrixOptions();
  let detail: ArticleDetail | null;
  try {
    detail = await window.articleAPI.get(id);
  } catch (err) {
    viewEl.innerHTML = '';
    viewEl.appendChild(el('p', { class: 'placeholder error', text: `読み込み失敗: ${errorMessage(err)}` }));
    return;
  }
  const route = parseRoute();
  if (route.type !== 'edit' || route.id !== id) return;
  if (!detail) {
    viewEl.innerHTML = '';
    viewEl.appendChild(notFoundView(id));
    return;
  }
  const a = detail.article;
  buildForm({
    mode: 'edit',
    articleId: id,
    initialCategoryPath: detail.categoryPath,
    title: a.title,
    body: a.body,
    tags: a.tags,
    skill: a.spaceSkill.skill,
    business: a.spaceSkill.business,
    attachments: (a.attachments || []).map((ref) => ({ source: 'existing', ref })),
  });
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
  renderChips(); // 既存タグ（編集時）を初期表示
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
  renderChips(); // 既存のスキル/業務（編集時）を初期表示
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
function attachmentsField(committed: EditAttachmentInput[]): HTMLElement {
  const wrap = el('div', { class: 'field' });
  wrap.appendChild(el('label', { class: 'field__label', text: '添付' }));

  const list = el('div', { class: 'attach-list' });
  const renderList = (): void => {
    list.innerHTML = '';
    if (committed.length === 0) {
      list.appendChild(el('p', { class: 'field__hint', text: 'まだ添付はありません。' }));
      return;
    }
    committed.forEach((item, i) => {
      list.appendChild(
        committedAttachRow(item, () => {
          committed.splice(i, 1);
          renderList();
        }),
      );
    });
  };

  const adder = buildAttachAdder((att) => {
    committed.push({ source: 'new', input: att });
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

//  追加済み添付（既存 or 新規）の表示情報
function describeAttachment(item: EditAttachmentInput): {
  icon: string;
  name: string;
  badge: { text: string; cls: string };
} {
  if (item.source === 'new') {
    const att = item.input;
    if (att.kind === 'upload') {
      return { icon: att.fileType === 'folder' ? '📁' : '📄', name: att.name, badge: ATTACH_BADGE.upload };
    }
    if (att.kind === 'fileServer') {
      return { icon: att.fileType === 'folder' ? '📁' : '📄', name: att.path, badge: ATTACH_BADGE.fileServer };
    }
    if (att.kind === 'article') {
      const t = summaryById.get(att.id)?.title;
      return { icon: '🔗', name: t ? `${t}（${att.id}）` : att.id, badge: ATTACH_BADGE.article };
    }
    return { icon: '🌐', name: att.name || att.url, badge: ATTACH_BADGE.link };
  }
  // existing（読み込んだ AttachmentRef）
  const ref = item.ref;
  if (ref.type === 'article') {
    const t = summaryById.get(ref.id)?.title;
    return { icon: '🔗', name: t ? `${t}（${ref.id}）` : ref.id, badge: ATTACH_BADGE.article };
  }
  if (ref.type === 'link') {
    return { icon: '🌐', name: ref.name || ref.url, badge: ATTACH_BADGE.link };
  }
  // file / folder
  const badge = ref.method === 'inFileServer' ? ATTACH_BADGE.fileServer : ATTACH_BADGE.upload;
  const name = ref.method === 'inFileServer' ? ref.path ?? ref.name : ref.name;
  return { icon: ref.type === 'folder' ? '📁' : '📄', name, badge };
}

//  追加済み添付の1行表示（削除可）
function committedAttachRow(item: EditAttachmentInput, onRemove: () => void): HTMLElement {
  const d = describeAttachment(item);
  const row = el('div', { class: 'attach-row' }, [
    el('span', { class: 'attach-row__icon', text: d.icon }),
    el('span', { class: 'attach-row__name', text: d.name }),
    el('span', { class: `badge ${d.badge.cls}`, text: d.badge.text }),
  ]);
  // 削除前に確認ポップアップ（ツーアクション）
  const isExistingInArticle =
    item.source === 'existing' &&
    (item.ref.type === 'file' || item.ref.type === 'folder') &&
    item.ref.method === 'inArticleDir';
  const x = el('button', { class: 'chip-sel__x', text: '×', title: '削除' });
  x.addEventListener('click', () => {
    openConfirmModal({
      title: '添付を削除しますか？',
      message:
        `「${d.name}」を一覧から削除します。` +
        (isExistingInArticle ? ' 保存時に記事内の実体ファイルも削除されます。' : ''),
      confirmText: '削除',
      onConfirm: onRemove,
    });
  });
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
//  お気に入り星ボタン（★=登録済み / ☆=未登録）
// ------------------------------------------------------------------ //
function favoriteButton(id: string): HTMLElement {
  const btn = el('button', { class: 'btn star-btn' });
  const paint = (fav: boolean): void => {
    btn.textContent = fav ? '★' : '☆';
    btn.classList.toggle('star-btn--on', fav);
    btn.title = fav ? 'お気に入りから解除' : 'お気に入りに登録';
    btn.setAttribute('aria-label', btn.title);
  };
  paint(isFavorite(id));
  btn.addEventListener('click', async () => {
    btn.setAttribute('disabled', 'true');
    try {
      const fav = await toggleFavorite(id);
      paint(fav);
    } catch (err) {
      showToast(`お気に入りの更新に失敗しました: ${errorMessage(err)}`, 'error');
    } finally {
      btn.removeAttribute('disabled');
    }
  });
  return btn;
}

// ------------------------------------------------------------------ //
//  記事の ⋯ メニュー（将来の機能追加用の器。今は削除のみ）
// ------------------------------------------------------------------ //
function articleMenu(detail: ArticleDetail): HTMLElement {
  const a = detail.article;
  const wrap = el('div', { class: 'kebab' });
  const btn = el('button', { class: 'btn kebab__btn', text: '⋯', title: 'その他' });
  const menu = el('div', { class: 'kebab__menu' });

  let closeHandler: ((e: MouseEvent) => void) | null = null;
  const closeMenu = (): void => {
    menu.classList.remove('open');
    if (closeHandler) {
      document.removeEventListener('click', closeHandler);
      closeHandler = null;
    }
  };
  const openMenu = (): void => {
    menu.classList.add('open');
    closeHandler = (ev): void => {
      if (!wrap.contains(ev.target as Node)) closeMenu();
    };
    setTimeout(() => document.addEventListener('click', closeHandler!), 0);
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('open')) closeMenu();
    else openMenu();
  });

  const del = el('button', { class: 'kebab__item kebab__item--danger', text: '記事を削除' });
  del.addEventListener('click', () => {
    closeMenu();
    openConfirmModal({
      title: '記事を削除しますか？',
      message:
        `この操作は取り消せません。記事ディレクトリ「${a.id}」を完全に削除します` +
        `（本文・記事内添付ファイルを含む）。`,
      confirmText: '削除',
      onConfirm: async () => {
        try {
          const result = await window.articleAPI.deleteArticle(a.id);
          if (result.status === 'ok') {
            await window.articleAPI.refresh();
            await loadIndex();
            await loadFavorites();
            renderSidebar();
            renderFavorites();
            populateSearchControls();
            showToast('記事を削除しました');
            navigate(detail.categoryPath.length ? categoryHash(detail.categoryPath) : '#/');
          } else {
            showToast(`削除失敗: ${result.message}`, 'error');
          }
        } catch (err) {
          showToast(`削除失敗: ${errorMessage(err)}`, 'error');
        }
      },
    });
  });
  menu.append(del);

  wrap.append(btn, menu);
  return wrap;
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

  // タイトル＋アクション（星・編集・⋯メニュー）（右上）
  const starBtn = favoriteButton(a.id);
  const editBtn = el('button', { class: 'btn', text: '編集' });
  editBtn.addEventListener('click', () => navigate(editHash(a.id)));
  page.appendChild(
    el('div', { class: 'page__toolbar' }, [
      el('h1', { class: 'article__title', text: a.title }),
      el('div', { class: 'article__actions' }, [starBtn, editBtn, articleMenu(detail)]),
    ]),
  );

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

  // 宇宙スキル標準（スキル・業務を内包）
  if (detail.skill.length || detail.business.length) {
    const inner = el('div', { class: 'space-skill' });
    if (detail.skill.length) {
      inner.appendChild(spaceSkillItem('スキル（skill）', labelChips(detail.skill)));
    }
    if (detail.business.length) {
      inner.appendChild(spaceSkillItem('業務（business）', labelChips(detail.business)));
    }
    page.appendChild(section('宇宙スキル標準', inner));
  }

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

//  宇宙スキル標準の内訳（スキル / 業務）1項目
function spaceSkillItem(label: string, body: Node): HTMLElement {
  return el('div', { class: 'space-skill__item' }, [
    el('div', { class: 'space-skill__label', text: label }),
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

// キーワード検索: Enter で実行
searchKeyword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = searchKeyword.value.trim();
    if (q) navigate(searchHash('kw', q));
  }
});
// タグ検索: 選択で実行
searchTag.addEventListener('change', () => {
  const t = searchTag.value;
  if (t) navigate(searchHash('tag', t));
});

// ------------------------------------------------------------------ //
//  サイドバー幅のリサイズ（右端ドラッグ、幅は localStorage に保存）
// ------------------------------------------------------------------ //
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 560;
const SIDEBAR_WIDTH_KEY = 'sidebarWidth';

function setSidebarWidth(px: number): void {
  const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(px)));
  document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
}

// 保存済みの幅を復元
try {
  const saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? '', 10);
  if (!Number.isNaN(saved)) setSidebarWidth(saved);
} catch {
  /* localStorage 不可でも無視 */
}

sidebarResizer.addEventListener('mousedown', (e) => {
  e.preventDefault();
  document.body.classList.add('resizing-x');
  const onMove = (ev: MouseEvent): void => {
    setSidebarWidth(ev.clientX - sidebarEl.getBoundingClientRect().left);
  };
  const onUp = (): void => {
    document.body.classList.remove('resizing-x');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    try {
      const w = getComputedStyle(document.documentElement)
        .getPropertyValue('--sidebar-w')
        .trim();
      if (w) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(parseInt(w, 10)));
    } catch {
      /* 保存失敗は無視 */
    }
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

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
    await loadFavorites();
    renderSidebar();
    renderFavorites();
    populateSearchControls();
    render();
  } catch (err) {
    treeEl.innerHTML = '';
    treeEl.appendChild(el('p', { class: 'placeholder error', text: `取得失敗: ${errorMessage(err)}` }));
  }
  initUser();
})();
