// Audio-only YouTube proxy for the XiaoZhi ESP32 device.
//
// The ESP32 can't run a YouTube search or decode web video itself, so this
// tiny service does the search + audio extraction (yt-dlp) and the format
// conversion (ffmpeg), then streams the result to the device as raw PCM -
// a format the board's existing I2S speaker path can play directly with no
// extra decoder on-device.
const express = require('express');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8080;

// Matches this project's board config.h: AUDIO_OUTPUT_SAMPLE_RATE 24000,
// mono. Keeping the proxy's output in that exact format means the firmware
// can feed it straight into the existing I2S output path with no on-device
// resampling.
const SAMPLE_RATE = 24000;
const CHANNELS = 1;

function sanitizeQuery(q) {
  if (typeof q !== 'string') return null;
  const trimmed = q.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  return trimmed;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// GET /play?q=<search text>
// Streams raw signed 16-bit little-endian mono PCM at 24000 Hz: the first
// YouTube search result's audio track, start to finish.
app.get('/play', (req, res) => {
  const query = sanitizeQuery(req.query.q);
  if (!query) {
    res.status(400).json({ error: 'missing or invalid q parameter' });
    return;
  }

  // yt-dlp resolves "ytsearch1:<query>" to the top result and streams its
  // best audio-only track to stdout; ffmpeg reads that from its stdin and
  // re-encodes to raw PCM on its stdout. Neither process touches disk, and
  // nothing here ever downloads/decodes the video track.
  const ytdlp = spawn('yt-dlp', [
    '-f', 'bestaudio',
    '--no-playlist',
    '--no-progress',
    '-o', '-',
    `ytsearch1:${query}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', 'pipe:0',
    '-f', 's16le',
    '-ar', String(SAMPLE_RATE),
    '-ac', String(CHANNELS),
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let ytdlpStderr = '';
  let ffmpegStderr = '';
  ytdlp.stderr.on('data', (chunk) => { ytdlpStderr += chunk.toString(); });
  ffmpeg.stderr.on('data', (chunk) => { ffmpegStderr += chunk.toString(); });

  // Guards every response-sending path below: yt-dlp and ffmpeg can each
  // independently fail, and this also has to survive a real streaming
  // footgun. The first version mixed `ffmpeg.stdout.once('data', ...)`
  // (to send headers only once real audio shows up) with
  // `ffmpeg.stdout.pipe(res)` for the actual transfer - two separate 'data'
  // consumers on the same stream. In production that produced HTTP 200 with
  // a 0-byte body nearly every time: pipe() wants to manage the stream's
  // flow itself, and attaching a plain 'data' listener first can and did
  // interfere with it. Forwarding every chunk through a single manual
  // listener (no .pipe() on this stream) removes that interaction.
  let responded = false;
  let headersSent = false;

  function sendHeadersIfNeeded() {
    if (headersSent) return;
    headersSent = true;
    responded = true;
    res.status(200);
    res.setHeader('Content-Type', 'audio/l16'); // raw PCM, not a container format
    res.setHeader('X-Sample-Rate', String(SAMPLE_RATE));
    res.setHeader('X-Channels', String(CHANNELS));
    res.setHeader('X-Sample-Format', 's16le');
    res.setHeader('Cache-Control', 'no-store');
  }

  ytdlp.stdout.pipe(ffmpeg.stdin);

  ffmpeg.stdout.on('data', (chunk) => {
    sendHeadersIfNeeded();
    res.write(chunk);
  });
  ffmpeg.stdout.on('end', () => {
    if (!res.writableEnded) res.end();
  });

  const cleanup = () => {
    ytdlp.kill('SIGKILL');
    ffmpeg.kill('SIGKILL');
  };
  req.on('close', cleanup);

  ytdlp.on('error', (err) => {
    console.error('yt-dlp failed to start:', err);
    if (!responded) {
      responded = true;
      res.status(500).json({ error: 'yt-dlp not available on server' });
    }
    cleanup();
  });
  ffmpeg.on('error', (err) => {
    console.error('ffmpeg failed to start:', err);
    if (!responded) {
      responded = true;
      res.status(500).json({ error: 'ffmpeg not available on server' });
    }
    cleanup();
  });

  ytdlp.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`yt-dlp exited ${code}: ${ytdlpStderr.slice(-2000)}`);
    }
  });
  ffmpeg.on('exit', (code) => {
    if (code !== 0 && code !== null && !responded) {
      responded = true;
      res.status(502).json({ error: 'could not fetch audio', detail: ffmpegStderr.slice(-500) });
    }
    if (!res.writableEnded) res.end();
  });
});

app.listen(PORT, () => {
  console.log(`xiaozhi-music-proxy listening on :${PORT}`);
});
