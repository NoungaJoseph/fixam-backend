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
  const { requireCloud = false, req } = options;
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileName = `${Date.now()}-${safeName}`;

  if (!supabase) {
    if (requireCloud) {
      throw new Error('Supabase Storage is not configured for persistent profile uploads.');
    }
    return uploadLocal(file, bucket, fileName, req);
  }

  try {
    let uploadRes = await supabase.storage
      .from(bucket)
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    // If bucket doesn't exist, create it dynamically and retry
    if (uploadRes.error && (uploadRes.error.message?.includes('not found') || uploadRes.error.statusCode === '404' || uploadRes.error.statusCode === 404)) {
      console.log(`Bucket '${bucket}' not found. Attempting to create it dynamically...`);
      const { error: createError } = await supabase.storage.createBucket(bucket, {
        public: true,
        allowedMimeTypes: null,
        fileSizeLimit: null
      });

      if (!createError) {
        console.log(`Bucket '${bucket}' created successfully. Retrying upload...`);
        uploadRes = await supabase.storage
          .from(bucket)
          .upload(fileName, file.buffer, {
            contentType: file.mimetype,
            upsert: true
          });
      } else {
        console.error(`Failed to create bucket '${bucket}':`, createError);
      }
    }

    if (uploadRes.error) throw uploadRes.error;

    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);

    return publicUrl;
  } catch (error) {
    console.error('Storage Upload Error:', error);
    if (requireCloud) {
      throw error;
    }
    return uploadLocal(file, bucket, fileName, req);
  }
};

module.exports = { uploadFile };
