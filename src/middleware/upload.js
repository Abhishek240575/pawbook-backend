// src/middleware/upload.js
// Cloudinary + Multer upload middleware
// Usage: router.post('/upload', uploadMiddleware.single('file'), uploadController.uploadFile)

const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Allowed MIME types ──────────────────────────────────────────────
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;  // 10 MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;  // 50 MB

// ── Cloudinary storage — images ─────────────────────────────────────
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder:         'pawbook',
    resource_type:  'image',
    upload_preset:  process.env.CLOUDINARY_UPLOAD_PRESET || 'pawbook_uploads',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
  }),
});

// ── Cloudinary storage — videos ─────────────────────────────────────
const videoStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder:        'pawbook',
    resource_type: 'video',
    upload_preset: process.env.CLOUDINARY_UPLOAD_PRESET || 'pawbook_uploads',
    allowed_formats: ['mp4', 'mov', 'webm'],
  }),
});

// ── Cloudinary storage — auto (image or video) ──────────────────────
const autoStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.mimetype);
    return {
      folder:        'pawbook',
      resource_type: isVideo ? 'video' : 'image',
      upload_preset: process.env.CLOUDINARY_UPLOAD_PRESET || 'pawbook_uploads',
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm'],
      ...(isVideo ? {} : { transformation: [{ quality: 'auto', fetch_format: 'auto' }] }),
    };
  },
});

// ── File filter ─────────────────────────────────────────────────────
function fileFilter(req, file, cb) {
  const allowed = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: images (jpg, png, gif, webp) and videos (mp4, mov, webm).`), false);
  }
}

// ── Exports: multer instances ───────────────────────────────────────
const uploadImage = multer({
  storage: imageStorage,
  fileFilter,
  limits: { fileSize: MAX_IMAGE_SIZE },
});

const uploadVideo = multer({
  storage: videoStorage,
  fileFilter,
  limits: { fileSize: MAX_VIDEO_SIZE },
});

const uploadAny = multer({
  storage: autoStorage,
  fileFilter,
  limits: { fileSize: MAX_VIDEO_SIZE },
});

// ── Helper: delete a Cloudinary asset by URL ────────────────────────
async function deleteFromCloudinary(url) {
  if (!url) return;
  try {
    // Extract public_id from URL: .../pawbook/<filename>.<ext> → pawbook/<filename>
    const parts = url.split('/');
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1) return;
    // Skip version segment (v12345) if present
    const afterUpload = parts.slice(uploadIndex + 1);
    if (/^v\d+$/.test(afterUpload[0])) afterUpload.shift();
    const withFolder = afterUpload.join('/').replace(/\.[^.]+$/, ''); // remove extension
    await cloudinary.uploader.destroy(withFolder);
  } catch (err) {
    console.error('[cloudinary:delete]', err.message);
  }
}

module.exports = { uploadImage, uploadVideo, uploadAny, deleteFromCloudinary, cloudinary };
