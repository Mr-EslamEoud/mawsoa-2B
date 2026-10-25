import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Readable } from "stream";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API router/routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Secure Audio Proxy for Google Drive files to bypass third-party cookie restrictions
  // Supports Range-based requests (206 Partial Content) needed for native players on Mobile WebKit/Chrome
  app.get("/api/proxy-audio", async (req, res) => {
    const { id } = req.query;
    if (!id || typeof id !== "string") {
      res.status(400).send("File ID is required");
      return;
    }

    try {
      const driveUrl = `https://docs.google.com/uc?export=download&id=${id}`;
      
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      };

      // Perfect Range header forwarding for iOS Safari & Android Chrome native audio players to support seek and autoplay
      if (req.headers.range) {
        headers["Range"] = req.headers.range;
      }

      const response = await fetch(driveUrl, { headers });

      // Accept both 200 (OK) and 206 (Partial Content)
      if (!response.ok && response.status !== 206) {
        res.status(response.status).send(`Failed to fetch from Google Drive: ${response.statusText}`);
        return;
      }

      // Preserve Content-Type or default to audio/mpeg
      const contentType = response.headers.get("content-type") || "audio/mpeg";
      res.setHeader("Content-Type", contentType);

      const contentRange = response.headers.get("content-range");
      if (contentRange) {
        res.setHeader("Content-Range", contentRange);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        res.setHeader("Content-Length", contentLength);
      }

      res.setHeader("Accept-Ranges", "bytes");
      // Set correct status code, default to 200 if response status doesn't match
      res.status(response.status);

      if (!response.body) {
        res.status(500).send("No content body from Google Drive");
        return;
      }

      // Convert the modern Web ReadableStream to a Node Readable Stream and pipe it to res
      const nodeReadable = Readable.fromWeb(response.body as any);
      nodeReadable.pipe(res);

    } catch (error: any) {
      console.error("Audio proxy execution error:", error);
      res.status(500).send(`Server Error: ${error.message}`);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Server running locally on http://localhost:${PORT}`);
  });
}

startServer();
