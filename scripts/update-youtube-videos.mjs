import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const apiKey = process.env.YOUTUBE_API_KEY;
const handle = process.env.YOUTUBE_HANDLE || '@minagi_rei';
const playlistIdFromEnv = process.env.YOUTUBE_PLAYLIST_ID || '';
const maxResults = Number(process.env.YOUTUBE_MAX_RESULTS || 20);
const outputPath = process.env.YOUTUBE_OUTPUT || 'data/videos.json';

function apiUrl(path, params) {
  const url = new URL('https://www.googleapis.com/youtube/v3/' + path);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  url.searchParams.set('key', apiKey);
  return url;
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function tagValue(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`));
  return match ? decodeXml(match[1].trim()) : '';
}

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
    const videoId = encodeURIComponent(v.id);

    let inner;
    if (v.embed === false) {
      const href = 'https://www.youtube.com/watch?v=' + videoId;
      const thumb = 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
      inner = [
        ind + '      <a class="yt-link-card"',
        ind + `         href="${href}"`,
        ind + '         target="_blank" rel="noopener noreferrer"',
        ind + `         aria-label="${cap} — YouTube で視聴">`,
        ind + `        <img src="${thumb}"`,
        ind + `             alt="${cap}" loading="lazy" />`,
        ind + '        <span class="yt-link-play" aria-hidden="true"></span>',
        ind + '        <span class="yt-link-badge">YouTube</span>',
        ind + '      </a>',
      ].join('\n');
    } else {
      const src = 'https://www.youtube.com/embed/' + videoId;
      inner = [
        ind + `      <iframe src="${src}"`,
        ind + `              title="${cap}"`,
        ind + '              frameborder="0"',
        ind + '              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"',
        ind + '              allowfullscreen loading="lazy"></iframe>',
      ].join('\n');
    }

    return [
      ind + '  <div class="yt-video-item">',
      ind + '    <div class="yt-embed-wrap">',
      inner,
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
  if (si === -1 || ei === -1 || ei < si) {
    throw new Error('movie.html の YT-GRID マーカーが見つからないか、順序が不正です。');
  }
  const newHtml =
    html.slice(0, si + START.length) +
    '\n' + renderMovieGrid(videos) + '\n      ' +
    html.slice(ei);
  await writeFile(htmlPath, newHtml, 'utf8');
  console.log(`Updated movie.html with ${videos.length} video cards.`);
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url.pathname} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

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

async function getLatestVideosFromFeed(playlistId) {
  const url = new URL('https://www.youtube.com/feeds/videos.xml');
  url.searchParams.set('playlist_id', playlistId);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`YouTube feed failed: ${response.status} ${await response.text()}`);
  }

  const xml = await response.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .slice(0, maxResults)
    .map((match) => {
      const entry = match[1];
      const id = tagValue(entry, 'yt:videoId');
      return {
        id,
        title: tagValue(entry, 'title'),
        publishedAt: tagValue(entry, 'published'),
        thumbnail: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''
      };
    })
    .filter((video) => video.id)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

async function getLatestVideos(playlistId) {
  const videos = [];
  let pageToken = '';

  while (videos.length < maxResults) {
    const data = await getJson(apiUrl('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: Math.min(50, maxResults - videos.length),
      pageToken
    }));

    for (const item of data.items || []) {
      const id = item.contentDetails && item.contentDetails.videoId;
      if (!id) continue;

      videos.push({
        id,
        title: item.snippet.title,
        publishedAt: item.contentDetails.videoPublishedAt || item.snippet.publishedAt,
        thumbnail: item.snippet.thumbnails?.maxres?.url ||
          item.snippet.thumbnails?.high?.url ||
          item.snippet.thumbnails?.medium?.url ||
          item.snippet.thumbnails?.default?.url ||
          ''
      });
    }

    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }

  return videos.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

async function getExistingVideoFlags() {
  try {
    const current = JSON.parse(await readFile(outputPath, 'utf8'));
    return new Map((current.videos || []).map((video) => [video.id, {
      embed: video.embed
    }]));
  } catch {
    return new Map();
  }
}

function mergeExistingFlags(videos, flags) {
  return videos.map((video) => {
    const current = flags.get(video.id);
    if (!current || current.embed === undefined) return video;
    return { ...video, embed: current.embed };
  });
}

const playlistId = await getUploadsPlaylistId();
const fetchedVideos = apiKey
  ? await getLatestVideos(playlistId)
  : await getLatestVideosFromFeed(playlistId);
const videos = mergeExistingFlags(fetchedVideos, await getExistingVideoFlags());

await writeFile(outputPath, JSON.stringify({
  updatedAt: new Date().toISOString(),
  channelHandle: handle,
  playlistId,
  videos
}, null, 2) + '\n', 'utf8');

console.log(`Wrote ${videos.length} videos to ${outputPath}.`);
if (videos.length > 0) await writeMovieHtml(videos);
