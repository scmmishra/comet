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
    /// Image files, such as projects' icons, by path. A handle must live to keep its decoded pixels, and views
    /// read the app's state without changing it, so these are kept behind a cell.
    files: std::cell::RefCell<HashMap<std::path::PathBuf, Image>>,
}

/// Icons are small, so files decode for 32 points at the Retina scale. SVG rasterizes at that size.
const FILE_POINTS: f32 = 32.0;
const FILE_SCALE: f32 = 2.0;

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

    /// An image file, decoding off the main thread on first use. None before the cache is set up.
    pub fn file(&self, path: &std::path::Path) -> Option<Image> {
        let cache = self.cache.as_ref()?;
        Some(self.files.borrow_mut().entry(path.to_owned()).or_insert_with(|| cache.file(path, FILE_POINTS, FILE_SCALE)).clone())
    }

    pub fn get(&self, image: &ImageAttachment) -> Option<&Image> {
        self.by_data.get(&key(image))
    }
}
