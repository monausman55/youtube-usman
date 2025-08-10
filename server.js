import express from "express";
import cors from "cors";
import { exec } from "child_process";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Helper: run shell command and return stdout
function runCmd(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 20, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

// Clean URL a bit (remove superfluous tracking params like ?si=...)
function sanitizeUrl(url) {
  if (!url) return url;
  // keep only the first query string (safe approach). yt-dlp handles most URLs anyway.
  const idx = url.indexOf("?si=");
  if (idx !== -1) return url.slice(0, idx);
  return url;
}

app.get("/download", async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).json({ error: "Missing ?url= parameter" });

  const url = sanitizeUrl(raw);

  try {
    // Use yt-dlp to get all formats JSON for the single video (no playlist)
    // --no-warnings to reduce noise; --no-playlist to avoid multiple JSONs
    const cmd = `yt-dlp -J --no-warnings --no-playlist "${url.replace(/"/g, '\\"')}"`;
    const out = await runCmd(cmd);

    const info = JSON.parse(out);

    // collect formats
    const formats = Array.isArray(info.formats) ? info.formats : [];

    // Helper filters
    const isProgressiveMp4 = f =>
      f.url && f.ext === "mp4" && f.vcodec !== "none" && f.acodec !== "none" && !f.url.includes(".m3u8");

    const isM4a = f =>
      f.url && (f.ext === "m4a" || (f.acodec && f.acodec.includes("mp4a")));

    const isAudioLike = f =>
      f.url && (f.ext === "mp3" || f.ext === "m4a" || f.ext === "webm" || (f.acodec && f.vcodec === "none"));

    // Gather MP4 progressive formats (video+audio)
    let mp4s = formats
      .filter(isProgressiveMp4)
      .map(f => ({
        format_id: f.format_id,
        quality_label: f.format_note || f.qualityLabel || (f.height ? `${f.height}p` : ""),
        height: f.height || null,
        filesize: f.filesize || f.filesize_approx || null,
        url: f.url
      }))
      .sort((a, b) => ( (b.height || 0) - (a.height || 0) ));

    // If no progressive mp4s found, try to synthesize candidate mp4 links:
    //  - pick mp4 video-only formats and provide their url (they are not muxed with audio)
    //  - pick bestvideo and bestaudio combined url (note: that url is usually a chunked stream / may be m3u8)
    if (mp4s.length === 0) {
      // try mp4 video-only + audio-only pairs (note: these are not single-file mp4s)
      const mp4VideoOnly = formats
        .filter(f => f.url && f.ext === "mp4" && f.vcodec !== "none" && (f.acodec === "none" || f.acodec === "none"))
        .map(f => ({
          format_id: f.format_id,
          quality_label: f.format_note || f.qualityLabel || (f.height ? `${f.height}p` : ""),
          height: f.height || null,
          filesize: f.filesize || f.filesize_approx || null,
          url: f.url,
          note: "video-only (no audio)"
        }))
        .sort((a,b) => ( (b.height||0) - (a.height||0) ));
      mp4s = mp4VideoOnly;
    }

    // M4A audio formats
    let m4as = formats
      .filter(isM4a)
      .map(f => ({
        format_id: f.format_id,
        abr: f.abr || f.tbr || null,
        filesize: f.filesize || f.filesize_approx || null,
        url: f.url
      }))
      .sort((a, b) => ( (b.abr || 0) - (a.abr || 0) ));

    // audio-like for MP3 fallback (prefer ext mp3, then m4a, then webm)
    let audios = formats
      .filter(isAudioLike)
      .map(f => ({
        format_id: f.format_id,
        ext: f.ext,
        abr: f.abr || f.tbr || null,
        filesize: f.filesize || f.filesize_approx || null,
        url: f.url
      }))
      .sort((a, b) => {
        // prefer mp3 > m4a > webm, then bitrate
        const order = ext => (ext === "mp3" ? 3 : ext === "m4a" ? 2 : ext === "webm" ? 1 : 0);
        return (order(b.ext) - order(a.ext)) || ((b.abr || 0) - (a.abr || 0));
      });

    // Limit results (up to 5 each)
    mp4s = mp4s.slice(0, 5);
    m4as = m4as.slice(0, 5);
    audios = audios.slice(0, 5);

    // Response
    res.json({
      title: info.title || info.video_title || null,
      id: info.id || null,
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      mp4: mp4s,
      m4a: m4as,
      audio_fallbacks: audios,
      note:
        "Returned direct links if available. If mp4 progressive links are missing, video-only mp4 or chunked streams may be returned. Some formats (HLS/DASH) might still be m3u8 or segmented if the source doesn't provide progressive files."
    });
  } catch (err) {
    console.error("yt-dlp error:", err.message || err);
    res.status(500).json({ error: "Failed to fetch formats", details: String(err.message || err) });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
