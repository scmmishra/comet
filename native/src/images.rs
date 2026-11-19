//! Images the app shows: those attached in the composer, those in the thread's messages, and image files
//! such as projects' icons and the images the panel opens. Each is decoded once, off the main thread, by
//! Rune's image cache.

use crate::base64;
use crate::protocol::ImageAttachment;
use rune::{Image, ImageCache, Waker};
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::Path;
use std::rc::Rc;

/// The pictures a view shows, by source, which it keeps while it holds them.
pub type Kept = Rc<std::cell::RefCell<HashMap<String, Image>>>;

#[derive(Default)]
pub struct Images {
    /// None until the app's setup gives it a waker, and in tests. Shared, so a view can load images as it draws.
    cache: Option<Rc<ImageCache>>,
    by_data: HashMap<u64, Image>,
    /// Image files, such as projects' icons, by path. A handle must live to keep its decoded pixels, and views
    /// read the app's state without changing it, so these are kept behind a cell.
    files: std::cell::RefCell<HashMap<std::path::PathBuf, Image>>,
}

/// Icons are small, so files decode for 32 points at the Retina scale. SVG rasterizes at that size.
const FILE_POINTS: f32 = 32.0;
const FILE_SCALE: f32 = 2.0;
/// An SVG in text, such as a diagram in a plugin's Markdown, rasterizes for the width of the thread's column.
const PICTURE_POINTS: f32 = 720.0;

fn key(image: &ImageAttachment) -> u64 {
    let mut h = DefaultHasher::new();
    image.data.hash(&mut h);
    h.finish()
}

impl Images {
    pub fn setup(&mut self, waker: Waker) {
        self.cache = Some(Rc::new(ImageCache::new(waker)));
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

    /// An image file at its own size, such as one open in the panel, decoding off the main thread. It is
    /// not kept here: the caller's handle keeps it, so it frees when the caller lets it go. None before the
    /// cache is set up.
    pub fn picture(&self, path: &std::path::Path) -> Option<Image> {
        // A raster image ignores the size, which only an SVG uses.
        Some(self.cache.as_ref()?.file(path, FILE_POINTS, FILE_SCALE))
    }

    /// Loads the image files a view shows, such as those a plugin's Markdown names, and keeps each in
    /// `kept` while the view holds it. Only an absolute path loads: the app fetches nothing from the network.
    pub fn file_loader(&self, kept: Kept) -> impl Fn(&str) -> Option<Image> + 'static {
        let cache = self.cache.clone();
        move |src: &str| {
            let cache = cache.as_ref()?;
            let path = Path::new(src);
            if !path.is_absolute() {
                return None;
            }
            Some(kept.borrow_mut().entry(src.to_owned()).or_insert_with(|| cache.file(path, PICTURE_POINTS, FILE_SCALE)).clone())
        }
    }

    pub fn get(&self, image: &ImageAttachment) -> Option<&Image> {
        self.by_data.get(&key(image))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_view_loads_an_image_file_by_absolute_path_and_keeps_it() {
        let mut images = Images::default();
        images.setup(std::sync::Arc::new(|| {}));
        let kept = Rc::new(std::cell::RefCell::new(HashMap::new()));
        let load = images.file_loader(kept.clone());
        let png = concat!(env!("CARGO_MANIFEST_DIR"), "/assets/Comet.icon/Assets/logo.png");
        let image = load(png).expect("an absolute path loads");
        assert!(image.wait().is_ok(), "{:?}", image.wait().err());
        assert_eq!(kept.borrow().len(), 1, "the view keeps what it loaded");
        assert!(load("relative/picture.png").is_none(), "a relative path does not load");
        assert!(load("https://example.com/picture.png").is_none(), "the app fetches nothing");
    }
}
