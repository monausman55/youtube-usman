import express from "express";
import cors from "cors";
import youtubedl from "youtube-dl-exec"; // ✅ No binary install needed

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Clean URL a bit (remove ?si= tracking params)
function sanitizeUrl(url) {
  if (!url) return url;
  const idx = url.indexOf("?si=");
  if (idx !== -1) return url.slice(0, idx);
  return url;
}

app.get("/download", async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).json({ error: "Missing ?url= parameter" });

  const url = sanitizeUrl(raw);

  try {
    // ✅ Call yt-dlp via youtube-dl-exec
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noPlaylist: true,
    });

    const formats = Array.isArray(info.formats) ? info.formats : [];

    // Filters
    const isProgressiveMp4 = f =>
      f.url && f.ext === "mp4" && f.vcodec !== "none" && f.acodec !== "none" && !f.url.includes(".m3u8");

    const isM4a = f =>
      f.url && (f.ext === "m4a" || (f.acodec && f.acodec.includes("mp4a")));

    const isAudioLike = f =>
      f.url && (f.ext === "mp3" || f.ext === "m4a" || f.ext === "webm" || (f.acodec && f.vcodec === "none"));

    // MP4 progressive formats
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

    if (mp4s.length === 0) {
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

    // M4A formats
    let m4as = formats
      .filter(isM4a)
      .map(f => ({
        format_id: f.format_id,
        abr: f.abr || f.tbr || null,
        filesize: f.filesize || f.filesize_approx || null,
        url: f.url
      }))
      .sort((a, b) => ( (b.abr || 0) - (a.abr || 0) ));

    // Audio fallbacks
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
        const order = ext => (ext === "mp3" ? 3 : ext === "m4a" ? 2 : ext === "webm" ? 1 : 0);
        return (order(b.ext) - order(a.ext)) || ((b.abr || 0) - (a.abr || 0));
      });

    // Limit results
    mp4s = mp4s.slice(0, 5);
    m4as = m4as.slice(0, 5);
    audios = audios.slice(0, 5);

    res.json({
      title: info.title || null,
      id: info.id || null,
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      mp4: mp4s,
      m4a: m4as,
      audio_fallbacks: audios,
      note:
        "Returned direct links if available. If mp4 progressive links are missing, video-only mp4 or chunked streams may be returned."
    });
  } catch (err) {
    console.error("yt-dlp error:", err);
    res.status(500).json({ error: "Failed to fetch formats", details: String(err.message || err) });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
