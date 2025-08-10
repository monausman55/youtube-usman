import express from "express";
import { exec } from "child_process";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({ status: "YouTube multi-format API is running" });
});

app.get("/download", (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ error: "Missing 'url' query parameter" });
  }

  // Get ALL formats without restricting to one
  const command = `yt-dlp --no-playlist --dump-json "${videoUrl}"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error("yt-dlp error:", stderr);
      return res.status(500).json({ error: "Failed to fetch video info" });
    }

    try {
      const info = JSON.parse(stdout);

      // Filter MP4 progressive (both video+audio, no m3u8)
      const mp4Formats = info.formats
        ?.filter(f =>
          f.ext === "mp4" &&
          f.vcodec !== "none" &&
          f.acodec !== "none" &&
          !f.url.includes(".m3u8")
        )
        .map(f => ({
          quality: f.format_note || f.resolution,
          fps: f.fps || null,
          size: f.filesize ? `${(f.filesize / (1024 * 1024)).toFixed(2)} MB` : "Unknown",
          url: f.url
        }))
        .sort((a, b) => {
          const numA = parseInt(a.quality) || 0;
          const numB = parseInt(b.quality) || 0;
          return numB - numA;
        });

      // Filter M4A audio (no m3u8)
      const m4aFormats = info.formats
        ?.filter(f =>
          f.ext === "m4a" &&
          f.acodec !== "none" &&
          !f.url.includes(".m3u8")
        )
        .map(f => ({
          quality: f.abr ? `${f.abr}kbps` : "Unknown",
          size: f.filesize ? `${(f.filesize / (1024 * 1024)).toFixed(2)} MB` : "Unknown",
          url: f.url
        }))
        .sort((a, b) => {
          const numA = parseInt(a.quality) || 0;
          const numB = parseInt(b.quality) || 0;
          return numB - numA;
        });

      res.json({
        title: info.title,
        thumbnail: info.thumbnail,
        videos: mp4Formats || [],
        audios: m4aFormats || []
      });

    } catch (err) {
      console.error("JSON parse error:", err);
      res.status(500).json({ error: "Failed to parse yt-dlp output" });
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
