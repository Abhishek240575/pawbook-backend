// src/controllers/upload.controller.js
// Handles media upload to Cloudinary via multer-storage-cloudinary

/**
 * POST /api/v1/media/upload
 * Body: multipart/form-data with field "file"
 * Optional query: ?type=avatar|cover|post|pet
 * Returns: { success, url, public_id, resource_type, width, height, format }
 */
async function uploadFile(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const file = req.file;

    // multer-storage-cloudinary stores Cloudinary response in file.path (the secure_url)
    // and extra fields in file
    const secure_url   = file.path;           // Cloudinary secure_url
    const public_id    = file.filename;       // Cloudinary public_id
    const resource_type = file.resource_type || 'image';
    const width        = file.width  || null;
    const height       = file.height || null;
    const format       = file.format || null;

    return res.status(201).json({
      success:       true,
      url:           secure_url,
      public_id,
      resource_type,
      width,
      height,
      format,
    });

  } catch (err) {
    console.error('[upload:uploadFile]', err);
    return res.status(500).json({ success: false, message: 'Upload failed. Please try again.' });
  }
}

/**
 * POST /api/v1/media/upload-multiple
 * Body: multipart/form-data with field "files" (up to 5)
 * Returns: { success, files: [{ url, public_id, ... }] }
 */
async function uploadMultiple(req, res) {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded.' });
    }

    const results = req.files.map(file => ({
      url:           file.path,
      public_id:     file.filename,
      resource_type: file.resource_type || 'image',
      width:         file.width  || null,
      height:        file.height || null,
      format:        file.format || null,
    }));

    return res.status(201).json({ success: true, files: results });

  } catch (err) {
    console.error('[upload:uploadMultiple]', err);
    return res.status(500).json({ success: false, message: 'Upload failed. Please try again.' });
  }
}

module.exports = { uploadFile, uploadMultiple };
