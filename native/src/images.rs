//! Images the app shows: those attached in the composer and those in the thread's messages. Each is
//! decoded once, off the main thread, by Rune's image cache.

use crate::base64;
use crate::protocol::ImageAttachment;
use rune::{Image, ImageCache, Waker};
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};

#[derive(Default)]
pub struct Images {
    /// None until the app's setup gives it a waker, and in tests.
    cache: Option<ImageCache>,
    by_data: HashMap<u64, Image>,
}

fn key(image: &ImageAttachment) -> u64 {
    let mut h = DefaultHasher::new();
    image.data.hash(&mut h);
    h.finish()
}

impl Images {
    pub fn setup(&mut self, waker: Waker) {
        self.cache = Some(ImageCache::new(waker));
    }

    /// Starts decoding `image`, once.
    pub fn remember(&mut self, image: &ImageAttachment) {
        let Some(cache) = &self.cache else { return };
        let key = key(image);
        if self.by_data.contains_key(&key) {
            return;
        }
        if let Some(bytes) = base64::decode(&image.data) {
            self.by_data.insert(key, cache.load(bytes));
        }
    }

    pub fn get(&self, image: &ImageAttachment) -> Option<&Image> {
        self.by_data.get(&key(image))
    }
}
