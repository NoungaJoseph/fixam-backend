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

const uploadLocal = async (file, bucket, fileName) => {
  const dir = path.join(process.cwd(), 'uploads', bucket);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), file.buffer);
  const baseUrl = process.env.PUBLIC_URL || 'https://fixam-backend-production.up.railway.app';
  return `${baseUrl}/uploads/${bucket}/${fileName}`;
};

const uploadFile = async (file, bucket, options = {}) => {
  const { requireCloud = false } = options;
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileName = `${Date.now()}-${safeName}`;

  if (!supabase) {
    if (requireCloud) {
      throw new Error('Supabase Storage is not configured for persistent profile uploads.');
    }
    return uploadLocal(file, bucket, fileName);
  }

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);

    return publicUrl;
  } catch (error) {
    console.error('Storage Upload Error:', error);
    if (requireCloud) {
      throw error;
    }
    return uploadLocal(file, bucket, fileName);
  }
};

module.exports = { uploadFile };
