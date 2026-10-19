require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_KEY
  || process.env.SUPABASE_ANON_KEY;

// The Supabase client expects the project root (https://<project>.supabase.co),
// not the PostgREST endpoint (…/rest/v1).  Accept the latter defensively because
// it otherwise produces invalid storage URLs such as /rest/v1/storage/v1/… .
const normalizeSupabaseUrl = (url) => (url || '').replace(/\/(?:rest\/v1)\/?$/i, '').replace(/\/$/, '');
const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const hasSupabase = Boolean(supabaseUrl && supabaseServiceKey);
const supabase = hasSupabase ? createClient(
  supabaseUrl,
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

// Creates a temporary URL for an existing file URL saved in the database.  This
// also repairs links that were previously generated with `/rest/v1` in the base
// URL; the bucket and object path are still present in those links.
const createSignedUrlForStoredFile = async (storedUrl, expiresIn = 10 * 60) => {
  if (!supabase) {
    throw createStorageUnavailableError('Cloud storage is not configured on the server.');
  }

  let parsed;
  try {
    parsed = new URL(storedUrl);
  } catch (_) {
    const error = new Error('The saved document link is invalid.');
    error.statusCode = 404;
    throw error;
  }

  const match = parsed.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/i);
  if (!match) {
    const error = new Error('The saved document is not in Supabase Storage.');
    error.statusCode = 404;
    throw error;
  }

  const bucket = decodeURIComponent(match[1]);
  const filePath = match[2].split('/').map(decodeURIComponent).join('/');
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(filePath, expiresIn);
  if (error || !data?.signedUrl) {
    const storageError = new Error(error?.message || 'The document could not be found in storage.');
    storageError.statusCode = error?.statusCode || 404;
    throw storageError;
  }
  return data.signedUrl;
};

module.exports = { uploadFile, createSignedUrlForStoredFile, normalizeSupabaseUrl };
