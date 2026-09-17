const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Compress an image buffer using Sharp.
 * - Resizes to max 1200px width (maintains aspect ratio)
 * - Converts to WebP at 80% quality
 * - Strips metadata (EXIF, etc.) to reduce size further
 * 
 * Typical savings: 60-80% size reduction while maintaining visual quality.
 * 
 * @param {Buffer} buffer - The raw image buffer
 * @param {string} originalMimetype - Original MIME type (e.g., 'image/jpeg')
 * @returns {Promise<{buffer: Buffer, mimetype: string, extension: string}>}
 */
const compressImage = async (buffer, originalMimetype) => {
  try {
    const metadata = await sharp(buffer).metadata();
    
    // Skip compression for very small images (< 50KB) or GIFs (animated)
    if (buffer.length < 50 * 1024 || originalMimetype === 'image/gif') {
      return { buffer, mimetype: originalMimetype, extension: getExtFromMime(originalMimetype) };
    }

    const maxWidth = 1200;
    const maxHeight = 1200;
    
    let pipeline = sharp(buffer)
      .rotate() // Auto-rotate based on EXIF orientation
      .withMetadata({ orientation: undefined }); // Strip EXIF but keep color profile

    // Only resize if image exceeds max dimensions
    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      pipeline = pipeline.resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Convert to WebP for best compression-to-quality ratio
    const compressed = await pipeline
      .webp({ quality: 80, effort: 4 })
      .toBuffer();

    // Only use compressed version if it's actually smaller
    if (compressed.length < buffer.length) {
      console.log(`[Media] Image compressed: ${(buffer.length / 1024).toFixed(0)}KB → ${(compressed.length / 1024).toFixed(0)}KB (${Math.round((1 - compressed.length / buffer.length) * 100)}% smaller)`);
      return { buffer: compressed, mimetype: 'image/webp', extension: 'webp' };
    }

    // If WebP is somehow larger (very rare), fall back to optimized JPEG
    const jpegCompressed = await sharp(buffer)
      .rotate()
      .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    if (jpegCompressed.length < buffer.length) {
      console.log(`[Media] Image compressed (JPEG fallback): ${(buffer.length / 1024).toFixed(0)}KB → ${(jpegCompressed.length / 1024).toFixed(0)}KB`);
      return { buffer: jpegCompressed, mimetype: 'image/jpeg', extension: 'jpg' };
    }

    // Original is already small enough
    return { buffer, mimetype: originalMimetype, extension: getExtFromMime(originalMimetype) };
  } catch (error) {
    console.error('[Media] Image compression failed, using original:', error.message);
    return { buffer, mimetype: originalMimetype, extension: getExtFromMime(originalMimetype) };
  }
};

/**
 * Compress a video buffer using FFmpeg.
 * - Re-encodes to H.264 with CRF 28 (good quality, much smaller file size)
 * - Scales to max 720p (maintains aspect ratio)
 * - Uses AAC audio at 128kbps
 * - Outputs MP4 container for maximum browser compatibility
 * 
 * Typical savings: 50-70% size reduction.
 * 
 * @param {Buffer} buffer - The raw video buffer
 * @param {string} originalMimetype - Original MIME type (e.g., 'video/mp4')
 * @returns {Promise<{buffer: Buffer, mimetype: string, extension: string}>}
 */
const compressVideo = async (buffer, originalMimetype) => {
  // Skip compression for very small videos (< 500KB)
  if (buffer.length < 500 * 1024) {
    return { buffer, mimetype: originalMimetype, extension: getExtFromMime(originalMimetype) };
  }

  const tempId = crypto.randomBytes(8).toString('hex');
  const tempDir = path.join(os.tmpdir(), 'fixam-media');
  const inputPath = path.join(tempDir, `input_${tempId}.tmp`);
  const outputPath = path.join(tempDir, `output_${tempId}.mp4`);

  try {
    // Ensure temp directory exists
    await fs.promises.mkdir(tempDir, { recursive: true });
    
    // Write input buffer to temp file
    await fs.promises.writeFile(inputPath, buffer);

    // Compress with FFmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',        // H.264 codec
          '-preset fast',         // Fast encoding preset (good balance)
          '-crf 28',              // Quality level (23=high, 28=medium, good for mobile)
          '-vf scale=\'min(1280,iw)\':\'min(720,ih)\':force_original_aspect_ratio=decrease:force_divisible_by=2',
          '-c:a aac',             // AAC audio
          '-b:a 128k',            // Audio bitrate
          '-movflags +faststart', // Optimize for web streaming
          '-y'                    // Overwrite output
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', (err) => {
          console.error('[Media] FFmpeg error:', err.message);
          reject(err);
        })
        .run();
    });

    // Read compressed output
    const compressed = await fs.promises.readFile(outputPath);

    // Only use compressed version if it's actually smaller
    if (compressed.length < buffer.length) {
      console.log(`[Media] Video compressed: ${(buffer.length / (1024 * 1024)).toFixed(1)}MB → ${(compressed.length / (1024 * 1024)).toFixed(1)}MB (${Math.round((1 - compressed.length / buffer.length) * 100)}% smaller)`);
      return { buffer: compressed, mimetype: 'video/mp4', extension: 'mp4' };
    }

    return { buffer, mimetype: originalMimetype, extension: getExtFromMime(originalMimetype) };
  } catch (error) {
    console.error('[Media] Video compression failed, using original:', error.message);
    return { buffer, mimetype: originalMimetype, extension: getExtFromMime(originalMimetype) };
  } finally {
    // Clean up temp files
    try { await fs.promises.unlink(inputPath); } catch (_) {}
    try { await fs.promises.unlink(outputPath); } catch (_) {}
  }
};

/**
 * Process a multer file object — compress based on MIME type.
 * Returns a new file-like object with the compressed buffer and updated metadata.
 * 
 * @param {Object} file - Multer file object with { buffer, mimetype, originalname }
 * @returns {Promise<Object>} - Processed file object
 */
const processMedia = async (file) => {
  if (!file || !file.buffer) return file;

  try {
    const isImage = file.mimetype && file.mimetype.startsWith('image/');
    const isVideo = file.mimetype && file.mimetype.startsWith('video/');

    if (isImage) {
      const result = await compressImage(file.buffer, file.mimetype);
      const baseName = (file.originalname || 'image').replace(/\.[^.]+$/, '');
      return {
        ...file,
        buffer: result.buffer,
        mimetype: result.mimetype,
        originalname: `${baseName}.${result.extension}`,
        size: result.buffer.length,
      };
    }

    if (isVideo) {
      const result = await compressVideo(file.buffer, file.mimetype);
      const baseName = (file.originalname || 'video').replace(/\.[^.]+$/, '');
      return {
        ...file,
        buffer: result.buffer,
        mimetype: result.mimetype,
        originalname: `${baseName}.${result.extension}`,
        size: result.buffer.length,
      };
    }
  } catch (error) {
    console.error('[Media] Processing failed, proceeding with original file:', error.message);
  }

  return file;
};

/** Helper: get file extension from MIME type */
const getExtFromMime = (mime) => {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/bmp': 'bmp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/3gpp': '3gp',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
  };
  return map[mime] || 'bin';
};

module.exports = { compressImage, compressVideo, processMedia };
