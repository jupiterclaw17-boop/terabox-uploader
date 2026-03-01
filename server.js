import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import dotenv from 'dotenv';
import { createRequire } from 'node:module';

dotenv.config();

const require = createRequire(import.meta.url);
const TeraboxUploader = require('terabox-upload-tool');

const app = express();
app.use(cors());

const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 1024 * 1024 * 1024), // 1GB default
  },
});

function getClient() {
  const ndus = process.env.TERABOX_NDUS;
  const jsToken = process.env.TERABOX_JS_TOKEN;
  const appId = process.env.TERABOX_APP_ID || '250528';

  if (!ndus || !jsToken) {
    throw new Error('Missing TERABOX_NDUS or TERABOX_JS_TOKEN');
  }

  return new TeraboxUploader({
    ndus,
    jsToken,
    appId,
    bdstoken: process.env.TERABOX_BDSTOKEN || '',
    browserId: process.env.TERABOX_BROWSER_ID || '',
  });
}

function extractFsId(details) {
  if (!details) return null;
  if (details.fs_id) return String(details.fs_id);
  if (Array.isArray(details.info) && details.info[0]?.fs_id) return String(details.info[0].fs_id);
  if (Array.isArray(details.list) && details.list[0]?.fs_id) return String(details.list[0].fs_id);
  return null;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'terabox-uploader' });
});

app.post('/upload', upload.single('file'), async (req, res) => {
  if ((req.headers['x-upload-token'] || '') !== (process.env.UPLOAD_API_TOKEN || '')) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'file is required' });
  }

  const remoteDir = req.body?.remoteDir || '/multitracks';

  try {
    const client = getClient();
    const uploadResult = await client.uploadFile(req.file.path, null, remoteDir);

    if (!uploadResult?.success) {
      return res.status(500).json({ error: uploadResult?.message || 'upload failed' });
    }

    const details = uploadResult.fileDetails;
    const fsId = extractFsId(details);

    if (!fsId) {
      return res.status(500).json({ error: 'missing fs_id in upload response', raw: details });
    }

    const dl = await client.downloadFile(fsId);
    const url = dl?.downloadLink || dl?.link || dl?.dlink || null;

    if (!url) {
      return res.status(500).json({ error: 'missing download url' });
    }

    return res.json({
      ok: true,
      url,
      storagePath: details?.path || `${remoteDir}/${req.file.originalname}`,
      fsId,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`terabox-uploader listening on :${port}`);
});
