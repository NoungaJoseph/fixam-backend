const { createClient } = require('@supabase/supabase-js');

const url1 = 'https://bvzebfcjirnrcjxxdjrt.supabase.co';
const url2 = 'https://bvzebfcjirnrcjxxdjrt.supabase.co/rest/v1';

const client1 = createClient(url1, 'fake-key');
const client2 = createClient(url2, 'fake-key');

console.log('Client 1 storage URL:', client1.storage.url);
console.log('Client 2 storage URL:', client2.storage.url);
