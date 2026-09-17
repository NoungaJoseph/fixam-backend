require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_KEY
  || process.env.SUPABASE_ANON_KEY;

const hasSupabase = Boolean(process.env.SUPABASE_URL && supabaseServiceKey);
const supabase = hasSupabase ? createClient(
  process.env.SUPABASE_URL,
  supabaseServiceKey
) : null;

const verifiedBuckets = new Set();

const createStorageUnavailableError = (message) => {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = 'MEDIA_UPLOAD_TEMPORARILY_UNAVAILABLE';
  error.publicMessage = 'We could not upload your file to cloud storage right now. Please check your connection and try again.';
  error.publicMessageFr = "Nous n'avons pas pu televerser votre fichier sur le stockage cloud pour le moment. Verifiez votre connexion, puis reessayez.";
  return error;
};

/**
 * Uploads media directly to Supabase Cloud Storage.
 * Never writes to local ephemeral server storage.
 */
const uploadFile = async (file, bucket) => {
  const safeName = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileName = `${Date.now()}-${safeName}`;

  if (!supabase) {
    console.error('[Storage Error] Supabase credentials missing (SUPABASE_URL or SUPABASE_SERVICE_ROLE).');
    throw createStorageUnavailableError('Cloud storage is not configured on the server.');
  }

  try {
    // If bucket not yet verified in memory, ensure it exists quickly once
    if (!verifiedBuckets.has(bucket)) {
      try {
        await supabase.storage.createBucket(bucket, { public: true });
      } catch (e) {
        // Bucket probably already exists
      }
      verifiedBuckets.add(bucket);
    }

    let uploadRes = await supabase.storage
      .from(bucket)
      .upload(fileName, file.buffer, {
        contentType: file.mimetype || 'application/octet-stream',
        upsert: true
      });

    if (uploadRes.error) {
      console.warn(`[Storage] Upload retry for '${bucket}': ${uploadRes.error.message || uploadRes.error}`);
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

    if (!publicUrl) {
      throw new Error('Could not retrieve public URL from Supabase.');
    }

    return publicUrl;
  } catch (error) {
    console.error(`[Storage Cloud Upload Error in bucket '${bucket}']`, error.message || error);
    throw createStorageUnavailableError(error.message || 'Cloud storage upload failed.');
  }
};

module.exports = { uploadFile };
