/**
 * File upload setup (multer), shared by social avatars/post images and the
 * encrypted room files.
 *
 * Two safety rules matter here:
 *  1. Stored names are random, never the name the browser sent. A crafted name
 *     like "../../server/app.js" therefore cannot escape the uploads folder.
 *  2. Image uploads check the MIME type; room files do not, because they arrive
 *     already encrypted as opaque bytes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('../utils/validate');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'public', 'uploads');

/** Builds an uploads subfolder and a multer storage engine writing into it. */
function storageFor(subfolder) {
  const dir = path.join(UPLOAD_ROOT, subfolder);
  fs.mkdirSync(dir, { recursive: true });

  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      // Keep only a known-safe extension from the original name.
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
      const safeExt = /^\.[a-z0-9]{1,9}$/.test(ext) ? ext : '';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
    },
  });
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function imageFilter(_req, file, cb) {
  if (!IMAGE_TYPES.includes(file.mimetype)) {
    return cb(new ApiError(400, 'Only JPG, PNG, GIF or WebP images are allowed.'));
  }
  cb(null, true);
}

// Avatars: small, images only.
const uploadAvatar = multer({
  storage: storageFor('avatars'),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: imageFilter,
});

// Post images: a little larger.
const uploadPostImage = multer({
  storage: storageFor('posts'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter,
});

// Room files: any type, because the bytes are AES-GCM ciphertext by the time
// they reach us and their real type is only known to clients with the key.
const uploadRoomFile = multer({
  storage: storageFor('rooms'),
  limits: { fileSize: 20 * 1024 * 1024 },
});

module.exports = {
  UPLOAD_ROOT,
  uploadAvatar,
  uploadPostImage,
  uploadRoomFile,
};
