require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs/promises');
const path = require('path');

const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.SUPABASE_KEY;
const hasSupabase = Boolean(process.env.SUPABASE_URL && supabaseServiceKey);
const supabase = hasSupabase ? createClient(
  process.env.SUPABASE_URL,
  supabaseServiceKey
) : null;

const uploadLocal = async (file, bucket, fileName, req) => {
  const dir = path.join(process.cwd(), 'uploads', bucket);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), file.buffer);
  
  let baseUrl = process.env.PUBLIC_URL;
  if (!baseUrl && req) {
    baseUrl = `${req.protocol}://${req.get('host')}`;
  }
  if (!baseUrl) {
    baseUrl = 'https://api.usefixam.com';
  }
  return `${baseUrl}/uploads/${bucket}/${fileName}`;
};

const uploadFile = async (file, bucket, options = {}) => {
  const { req } = options;
  const safeName = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileName = `${Date.now()}-${safeName}`;

  if (!supabase) {
    console.warn('[Storage] Supabase client not initialized. Falling back to local server storage.');
    return uploadLocal(file, bucket, fileName, req);
  }

  try {
    let uploadRes = await supabase.storage
      .from(bucket)
      .upload(fileName, file.buffer, {
        contentType: file.mimetype || 'application/octet-stream',
        upsert: true
      });

    // If bucket upload fails, attempt creating/ensuring public bucket and retry
    if (uploadRes.error) {
      console.warn(`[Storage] Upload error for bucket '${bucket}': ${uploadRes.error.message || uploadRes.error}. Attempting bucket creation...`);
      try {
        await supabase.storage.createBucket(bucket, { public: true });
      } catch (e) {
        console.warn(`[Storage] Bucket creation notice:`, e.message);
      }

      // Retry upload after bucket check
      uploadRes = await supabase.storage
        .from(bucket)
        .upload(fileName, file.buffer, {
          contentType: file.mimetype || 'application/octet-stream',
          upsert: true
        });
    }

    if (uploadRes.error) throw uploadRes.error;

    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);

    return publicUrl;
  } catch (error) {
    console.error('[Storage] Storage Upload Error, using fallback:', error.message || error);
    return uploadLocal(file, bucket, fileName, req);
  }
};

module.exports = { uploadFile };
