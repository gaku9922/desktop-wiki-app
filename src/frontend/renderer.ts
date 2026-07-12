// ------------------------------------------------------------------ //
//  DOM 参照
// ------------------------------------------------------------------ //
const treeEl        = document.getElementById('tree')!;
const editorEl      = document.getElementById('editor') as HTMLTextAreaElement;
const editorTitle   = document.getElementById('editorTitle')!;
const editorError   = document.getElementById('editorError')!;
const saveBtn       = document.getElementById('saveBtn') as HTMLButtonElement;
const deleteBtn     = document.getElementById('deleteBtn') as HTMLButtonElement;
const refreshBtn    = document.getElementById('refreshBtn')!;
const newPathEl     = document.getElementById('newPath') as HTMLInputElement;
const newContentEl  = document.getElementById('newContent') as HTMLTextAreaElement;
const createError   = document.getElementById('createError')!;
const createBtn     = document.getElementById('createBtn')!;
const rootBadge     = document.getElementById('rootBadge')!;
const uploadDirEl   = document.getElementById('uploadDir') as HTMLInputElement;
const uploadBtn     = document.getElementById('uploadBtn') as HTMLButtonElement;
const uploadError   = document.getElementById('uploadError')!;

// ユーザー関連 DOM
const userBadge      = document.getElementById('userBadge') as HTMLButtonElement;
const userBadgeName  = document.getElementById('userBadgeName')!;
const userModal      = document.getElementById('userModal')!;
const userModalTitle = document.getElementById('userModalTitle')!;
const userModalDesc  = document.getElementById('userModalDesc')!;
const userNameInput  = document.getElementById('userNameInput') as HTMLInputElement;
const userModalError = document.getElementById('userModalError')!;
const userCancelBtn  = document.getElementById('userCancelBtn') as HTMLButtonElement;
const userSaveBtn    = document.getElementById('userSaveBtn') as HTMLButtonElement;

// 現在エディタで開いているファイルの相対パス
let currentPath: string | null = null;

// ------------------------------------------------------------------ //
//  ユーティリティ
// ------------------------------------------------------------------ //
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function showToast(message: string): void {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('toast--visible');
    setTimeout(() => {
      toast.classList.remove('toast--visible');
      toast.addEventListener('transitionend', () => toast.remove());
    }, 2000);
  });
}

// ------------------------------------------------------------------ //
//  ツリー描画
// ------------------------------------------------------------------ //
async function refreshTree(): Promise<void> {
  try {
    const nodes = await window.fileAPI.list();
    renderTree(nodes);
  } catch (err) {
    treeEl.innerHTML = `<p class="placeholder error">取得失敗: ${errorMessage(err)}</p>`;
  }
}

function buildTreeUl(nodes: TreeNode[]): HTMLUListElement {
  const ul = document.createElement('ul');
  ul.className = 'tree__list';

  for (const node of nodes) {
    const li = document.createElement('li');
    li.className = `tree__item tree__item--${node.type}`;

    if (node.type === 'dir') {
      const toggle = document.createElement('span');
      toggle.className = 'tree__toggle';
      toggle.textContent = '▾';

      const label = document.createElement('span');
      label.className = 'tree__label';
      label.textContent = node.name;

      const children = buildTreeUl(node.children);
      children.className += ' tree__children';

      toggle.addEventListener('click', () => {
        const isOpen = children.style.display !== 'none';
        children.style.display = isOpen ? 'none' : '';
        toggle.textContent = isOpen ? '▸' : '▾';
      });

      li.append(toggle, label, children);

    } else if (node.type === 'json') {
      // JSON ファイル → エディタで開く
      const label = document.createElement('span');
      label.className = 'tree__label tree__label--file';
      if (node.relativePath === currentPath) {
        label.classList.add('tree__label--active');
      }
      label.textContent = node.name;
      label.addEventListener('click', () => openFile(node.relativePath));
      li.appendChild(label);

    } else {
      // その他ファイル → ダウンロード
      const label = document.createElement('span');
      label.className = 'tree__label tree__label--file tree__label--other';
      label.textContent = node.name;
      label.title = 'クリックでダウンロード';

      const hint = document.createElement('span');
      hint.className = 'tree__dl-hint';
      hint.textContent = '↓';

      label.addEventListener('click', () => downloadFile(node.relativePath));
      li.append(label, hint);
    }

    ul.appendChild(li);
  }

  return ul;
}

function renderTree(nodes: TreeNode[]): void {
  treeEl.innerHTML = '';
  if (nodes.length === 0) {
    treeEl.innerHTML = '<p class="placeholder">ファイルがありません</p>';
    return;
  }
  treeEl.appendChild(buildTreeUl(nodes));
}

// ------------------------------------------------------------------ //
//  JSON エディタ操作
// ------------------------------------------------------------------ //
async function openFile(relativePath: string): Promise<void> {
  try {
    const data = await window.fileAPI.read(relativePath);
    currentPath = relativePath;
    editorTitle.textContent = relativePath;
    editorEl.value = JSON.stringify(data, null, 2);
    editorEl.disabled = false;
    saveBtn.disabled = false;
    deleteBtn.disabled = false;
    editorError.textContent = '';
    refreshTree();
  } catch (err) {
    editorError.textContent = `読み込み失敗: ${errorMessage(err)}`;
  }
}

saveBtn.addEventListener('click', async () => {
  if (!currentPath) return;
  editorError.textContent = '';

  let parsed: unknown;
  try {
    parsed = JSON.parse(editorEl.value);
  } catch {
    editorError.textContent = 'JSON の形式が正しくありません。';
    return;
  }

  try {
    const newTree = await window.fileAPI.write(currentPath, parsed);
    renderTree(newTree);
    showToast('保存しました');
  } catch (err) {
    editorError.textContent = `保存失敗: ${errorMessage(err)}`;
  }
});

deleteBtn.addEventListener('click', async () => {
  if (!currentPath) return;
  if (!confirm(`「${currentPath}」を削除しますか？`)) return;

  try {
    const newTree = await window.fileAPI.delete(currentPath);
    currentPath = null;
    editorTitle.textContent = 'ファイルを選択してください';
    editorEl.value = '';
    editorEl.disabled = true;
    saveBtn.disabled = true;
    deleteBtn.disabled = true;
    editorError.textContent = '';
    renderTree(newTree);
    showToast('削除しました');
  } catch (err) {
    editorError.textContent = `削除失敗: ${errorMessage(err)}`;
  }
});

// ------------------------------------------------------------------ //
//  ダウンロード
// ------------------------------------------------------------------ //
async function downloadFile(relativePath: string): Promise<void> {
  try {
    await window.fileAPI.download(relativePath);
  } catch (err) {
    showToast(`ダウンロード失敗: ${errorMessage(err)}`);
  }
}

// ------------------------------------------------------------------ //
//  新規 JSON 作成
// ------------------------------------------------------------------ //
createBtn.addEventListener('click', async () => {
  createError.textContent = '';
  const relPath = newPathEl.value.trim();
  const rawJson = newContentEl.value.trim();

  if (!relPath) {
    createError.textContent = 'ファイルパスを入力してください。';
    return;
  }
  if (!relPath.endsWith('.json')) {
    createError.textContent = 'パスは .json で終わる必要があります。';
    return;
  }

  let parsed: unknown;
  try {
    parsed = rawJson ? JSON.parse(rawJson) : {};
  } catch {
    createError.textContent = 'JSON の形式が正しくありません。';
    return;
  }

  try {
    const newTree = await window.fileAPI.write(relPath, parsed);
    renderTree(newTree);
    newPathEl.value = '';
    newContentEl.value = '';
    showToast(`「${relPath}」を作成しました`);
    openFile(relPath);
  } catch (err) {
    createError.textContent = `作成失敗: ${errorMessage(err)}`;
  }
});

// ------------------------------------------------------------------ //
//  ファイルアップロード
// ------------------------------------------------------------------ //
uploadBtn.addEventListener('click', async () => {
  uploadError.textContent = '';
  const destDir = uploadDirEl.value.trim();

  try {
    const newTree = await window.fileAPI.upload(destDir);
    if (newTree) {
      renderTree(newTree);
      uploadDirEl.value = '';
      showToast('アップロードしました');
    }
  } catch (err) {
    uploadError.textContent = `アップロード失敗: ${errorMessage(err)}`;
  }
});

// ------------------------------------------------------------------ //
//  ユーザー登録 / 名前変更
// ------------------------------------------------------------------ //

// true: 初回登録（キャンセル不可）/ false: 名前変更（キャンセル可）
let userModalRequired = false;

// ヘッダー右上のバッジに名前を反映する
function renderUserBadge(name: string): void {
  userBadgeName.textContent = name;
  userBadge.hidden = false;
}

// モーダルを開く。required=true のときはキャンセルを許可しない
function openUserModal(currentName: string, required: boolean): void {
  userModalRequired = required;
  userModalError.textContent = '';
  userNameInput.value = currentName;

  if (required) {
    userModalTitle.textContent = 'ようこそ';
    userModalDesc.textContent  = 'お名前を登録してください。';
    userSaveBtn.textContent    = '登録';
    userCancelBtn.hidden       = true;
  } else {
    userModalTitle.textContent = '名前の変更';
    userModalDesc.textContent  = '新しいお名前を入力してください。';
    userSaveBtn.textContent    = '保存';
    userCancelBtn.hidden       = false;
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

// Enter で保存
userNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitUserName();
});

// キャンセル（変更モードのみ表示）
userCancelBtn.addEventListener('click', closeUserModal);

// バッジクリックで名前変更
userBadge.addEventListener('click', () => {
  openUserModal(userBadgeName.textContent ?? '', false);
});

// 起動時: 登録済みならバッジ表示、未登録なら登録モーダルを表示
async function initUser(): Promise<void> {
  try {
    const user = await window.userAPI.get();
    if (user) {
      renderUserBadge(user.name);
    } else {
      openUserModal('', true);
    }
  } catch {
    // 取得に失敗した場合も登録を促す
    openUserModal('', true);
  }
}

// ------------------------------------------------------------------ //
//  初期化
// ------------------------------------------------------------------ //
refreshBtn.addEventListener('click', refreshTree);

(async () => {
  try {
    const rootDir = await window.fileAPI.getRootDir();
    rootBadge.textContent = rootDir;
    rootBadge.title = rootDir;
  } catch {
    rootBadge.textContent = '(パス取得失敗)';
  }
  refreshTree();
  initUser();
})();
