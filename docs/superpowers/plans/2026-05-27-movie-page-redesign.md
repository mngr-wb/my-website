# Movie Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `movie.html` の動画グリッドを、iframe ゼロの静的サムネイルカードに置き換え、`update-youtube-videos.mjs` を実行するだけで最新順に自動更新できるようにする。

**Architecture:** `update-youtube-videos.mjs` が `data/videos.json` の書き出しと同時に `movie.html` の `<!-- YT-GRID:START -->〜<!-- YT-GRID:END -->` ブロックを静的カード HTML で上書きする。閲覧時は iframe なし・fetch なし・JS 不要（動画セクション）。

**Tech Stack:** Node.js ESM, YouTube RSS フィード, 静的 HTML/CSS

---

## ファイル構成

| ファイル | 変更内容 |
|---|---|
| `scripts/update-youtube-videos.mjs` | import 追加、`escapeHtml` / `cleanTitle` / `renderMovieGrid` / `writeMovieHtml` 関数を追加、`getUploadsPlaylistId` にフォールバック処理を追加、末尾に `writeMovieHtml(videos)` 呼び出しを追加 |
| `movie.html` | `yt-video-grid` ブロックを YT-GRID マーカー + 空グリッドに差し替え、`movie-links.js` の `<script>` タグを削除 |
| `js/movie-links.js` | 削除（不要になる） |

---

## Task 1: update-youtube-videos.mjs — import 追加と helper 関数

**Files:**
- Modify: `scripts/update-youtube-videos.mjs:1`

- [ ] **Step 1: import を差し替える（1 行目）**

`scripts/update-youtube-videos.mjs` の先頭1行を以下に置き換える：

```javascript
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
```

- [ ] **Step 2: `tagValue` 関数の直後（29行目のあと）に helper 関数を追加**

```javascript
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cleanTitle(title) {
  let t = title.replace(/  +/g, ' ').trim();
  // コラボ: "(Cover)-海凪 澪×{相手}" → "with {相手}"
  let m = t.match(/\(Cover\)-海凪 澪×(.+)$/);
  if (m) return t.slice(0, m.index).trim() + ' with ' + m[1].trim();
  // コラボ: "/ 海凪澪×{相手}【...】" → 曲名 + "with {相手}"
  m = t.match(/ \/ 海凪澪×([^【]+)【[^】]*】/);
  if (m) return t.slice(0, m.index).trim() + ' with ' + m[1].trim();
  // ソロ: "(Cover)-海凪 澪" を除去
  t = t.replace(/\s*\(Cover\)-海凪 澪\s*$/, '').trim();
  // スラッシュ前後のスペースを正規化 ("foo/bar" → "foo / bar")
  return t.replace(/(\S)\/(\S)/g, '$1 / $2');
}

function renderMovieGrid(videos) {
  const ind = '      ';
  const cards = videos.map((v) => {
    const cap = escapeHtml(cleanTitle(v.title));
    const href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(v.id);
    const thumb = 'https://i.ytimg.com/vi/' + encodeURIComponent(v.id) + '/hqdefault.jpg';
    return [
      ind + '  <div class="yt-video-item">',
      ind + '    <div class="yt-embed-wrap">',
      ind + '      <a class="yt-link-card"',
      ind + `         href="${href}"`,
      ind + '         target="_blank" rel="noopener"',
      ind + `         aria-label="${cap} — YouTube で視聴">`,
      ind + `        <img src="${thumb}"`,
      ind + `             alt="${cap}" loading="lazy" />`,
      ind + '        <span class="yt-link-play" aria-hidden="true"></span>',
      ind + '        <span class="yt-link-badge">YouTube</span>',
      ind + '      </a>',
      ind + '    </div>',
      ind + `    <p class="yt-caption">${cap}</p>`,
      ind + '  </div>',
    ].join('\n');
  });
  return (
    ind + '<div class="yt-video-grid">\n\n' +
    cards.join('\n\n') +
    '\n\n' + ind + '</div>'
  );
}

async function writeMovieHtml(videos) {
  const htmlPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'movie.html');
  const html = await readFile(htmlPath, 'utf8');
  const START = '<!-- YT-GRID:START -->';
  const END = '<!-- YT-GRID:END -->';
  const si = html.indexOf(START);
  const ei = html.indexOf(END);
  if (si === -1 || ei === -1) {
    throw new Error('movie.html に YT-GRID マーカーが見つかりません。Task 2 を先に実施してください。');
  }
  const newHtml =
    html.slice(0, si + START.length) +
    '\n' + renderMovieGrid(videos) + '\n      ' +
    html.slice(ei);
  await writeFile(htmlPath, newHtml, 'utf8');
  console.log(`Updated movie.html with ${videos.length} video cards.`);
}
```

- [ ] **Step 3: `cleanTitle` の動作をインラインで検証**

```powershell
node -e @'
function cleanTitle(title) {
  let t = title.replace(/  +/g, " ").trim();
  let m = t.match(/\(Cover\)-海凪 澪×(.+)$/);
  if (m) return t.slice(0, m.index).trim() + " with " + m[1].trim();
  m = t.match(/ \/ 海凪澪×([^【]+)【[^】]*】/);
  if (m) return t.slice(0, m.index).trim() + " with " + m[1].trim();
  t = t.replace(/\s*\(Cover\)-海凪 澪\s*$/, "").trim();
  return t.replace(/(\S)\/(\S)/g, "$1 / $2");
}
const cases = [
  ["初恋日記  / 香椎モイミ(Cover)-海凪 澪", "初恋日記 / 香椎モイミ"],
  ["エゴロック / すりぃ(Cover)-海凪 澪×いなみ", "エゴロック / すりぃ with いなみ"],
  ["絶対敵対メチャキライヤー / 海凪澪×晴風えそら【歌ってみた】", "絶対敵対メチャキライヤー with 晴風えそら"],
  ["ワールド・ランプシェード/buzzG(Cover)-海凪 澪", "ワールド・ランプシェード / buzzG"],
  ["曖昧劣情lover/koyori(Cover)-海凪 澪", "曖昧劣情lover / koyori"],
];
let ok = true;
for (const [input, expected] of cases) {
  const actual = cleanTitle(input);
  if (actual !== expected) { console.error("FAIL:", JSON.stringify(input), "->", JSON.stringify(actual), "(expected:", JSON.stringify(expected) + ")"); ok = false; }
}
if (ok) console.log("PASS: all cleanTitle tests passed");
'@
```

期待される出力：`PASS: all cleanTitle tests passed`

---

## Task 2: update-youtube-videos.mjs — getUploadsPlaylistId 更新 + 末尾呼び出し追加

**Files:**
- Modify: `scripts/update-youtube-videos.mjs`

- [ ] **Step 1: `getUploadsPlaylistId` 関数全体を置き換える**

現在の `getUploadsPlaylistId`（`async function getUploadsPlaylistId() { ... }`）を以下で置き換える：

```javascript
async function getUploadsPlaylistId() {
  if (playlistIdFromEnv) return playlistIdFromEnv;

  if (apiKey) {
    const data = await getJson(apiUrl('channels', {
      part: 'contentDetails',
      forHandle: handle,
      maxResults: 1
    }));
    const channel = data.items && data.items[0];
    const id = channel && channel.contentDetails.relatedPlaylists.uploads;
    if (!id) throw new Error(`Uploads playlist was not found for ${handle}.`);
    return id;
  }

  // API key なし・env 未設定の場合: videos.json に保存済みの playlistId を使う
  try {
    const current = JSON.parse(await readFile(outputPath, 'utf8'));
    if (current.playlistId) return current.playlistId;
  } catch { /* 無視 */ }

  throw new Error(
    'YOUTUBE_API_KEY または YOUTUBE_PLAYLIST_ID を設定するか、' +
    '先に API key を使って一度スクリプトを実行してください。'
  );
}
```

- [ ] **Step 2: ファイル末尾の2行のあとに writeMovieHtml 呼び出しを追加**

現在の末尾：
```javascript
await writeFile(outputPath, JSON.stringify({
  updatedAt: new Date().toISOString(),
  channelHandle: handle,
  playlistId,
  videos
}, null, 2) + '\n', 'utf8');

console.log(`Wrote ${videos.length} videos to ${outputPath}.`);
```

↓ この直後に追加：
```javascript
await writeMovieHtml(videos);
```

---

## Task 3: movie.html — YT-GRID マーカー追加 + iframe 削除

**Files:**
- Modify: `movie.html:50-154`
- Modify: `movie.html:194`

- [ ] **Step 1: `yt-video-grid` ブロック（lines 50–152）を YT-GRID マーカーで置き換える**

以下のブロック全体を（`<div class="yt-video-grid">` から閉じる `</div>` まで）：

```html
      <div class="yt-video-grid">

        <div class="yt-video-item">
          <div class="yt-embed-wrap">
            <iframe src="https://www.youtube.com/embed/T7ovPvP2oPE"
```

（〜10件のiframeアイテムを含む長いブロック〜）

```html
      </div>
```

↓ 以下に差し替える：

```html
      <!-- YT-GRID:START -->
      <div class="yt-video-grid">
      </div>
      <!-- YT-GRID:END -->
```

- [ ] **Step 2: `movie-links.js` の `<script>` タグを削除する**

削除対象（line 194 付近）：
```html
  <script src="js/movie-links.js"></script>
```

この1行をまるごと削除する。

---

## Task 4: スクリプト実行・動作確認・コミット

**Files:**
- Verify: `movie.html`
- Delete: `js/movie-links.js`

- [ ] **Step 1: 更新スクリプトを実行する**

```powershell
cd C:/0_Developer/website/minagirei-Official
node scripts/update-youtube-videos.mjs
```

期待される出力（API key なし・env なしでも videos.json の playlistId を使って動作）：
```
Wrote 14 videos to data/videos.json.
Updated movie.html with 14 video cards.
```

- [ ] **Step 2: movie.html の内容を検証する**

```powershell
# yt-video-item の数が 14 であることを確認
(Select-String -Path "movie.html" -Pattern "yt-video-item").Count

# iframe が残っていないことを確認（出力なし = OK）
Select-String -Path "movie.html" -Pattern "<iframe"

# movie-links.js の参照が残っていないことを確認（出力なし = OK）
Select-String -Path "movie.html" -Pattern "movie-links"

# YT-GRID マーカーが存在することを確認
Select-String -Path "movie.html" -Pattern "YT-GRID"
```

期待される出力：
```
14          ← yt-video-item の数
（なし）     ← <iframe
（なし）     ← movie-links
(2件)        ← YT-GRID:START と YT-GRID:END
```

- [ ] **Step 3: ブラウザで確認する**

ローカルサーバーが起動していれば `http://localhost:8000/movie.html` を開き：
- 14枚のサムネイルカードが2カラムグリッドで表示されること
- 各カードに赤い再生ボタンと「YouTube」バッジが表示されること
- キャプションが正しく表示されること（例: `エゴロック / すりぃ with いなみ`）
- カードクリックで YouTube が新規タブで開くこと
- リロードを繰り返しても白画面にならないこと

- [ ] **Step 4: movie-links.js を削除する**

```powershell
Remove-Item C:/0_Developer/website/minagirei-Official/js/movie-links.js
```

- [ ] **Step 5: コミットする**

```powershell
cd C:/0_Developer/website/minagirei-Official
git add scripts/update-youtube-videos.mjs movie.html data/videos.json
git add -u js/movie-links.js
git commit -m "feat: Movie page - static thumbnail cards from playlist data

- update-youtube-videos.mjs が movie.html を自動更新するよう拡張
- iframe を排除し、サムネイル + YouTube リンクカード方式に移行
- キャプションのタイトル自動クリーニング（コラボは 'with {相手}' 形式）
- movie-links.js は不要になったため削除

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
