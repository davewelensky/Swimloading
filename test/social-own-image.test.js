import test from 'node:test';
import assert from 'node:assert/strict';
import { publicUrl } from '../api/_lib/social/store.js';

test('a bucket path resolves to the public posts bucket', () => {
    assert.match(publicUrl('2026-11-21/jaked-about/slide-1.jpg'), /\/storage\/v1\/object\/public\/social-posts\/2026-11-21\/jaked-about\/slide-1\.jpg$/);
});

test('an image on swimloading.com is used as it is', () => {
    const url = 'https://www.swimloading.com/partners/form-12-swims-post.jpg';
    assert.equal(publicUrl(url), url);
});

test('no other address is ever fetched', () => {
    for (const bad of ['https://evil.example/x.jpg', 'https://www.swimloading.com.evil.example/x.jpg', 'http://www.swimloading.com/x.jpg', 'https://www.swimloading.com/api/x?y=.jpg']) {
        assert.ok(publicUrl(bad).startsWith('https://szgkzuswelntnevobnoh.supabase.co/storage/'), bad);
    }
});
