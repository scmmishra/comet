//! Images sent with a message, as `app/src/renderer/attachments.ts` reads them: PNG, JPEG, GIF or WebP,
//! up to the size Claude takes.

use crate::base64;
use crate::protocol::ImageAttachment;
use std::path::Path;

/// The largest image Claude takes, in bytes before base64 (`MAX_IMAGE_BYTES` in the protocol).
pub const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;
/// The image types Claude reads, by extension (`IMAGE_TYPES` in the protocol).
const TYPES: [(&str, &str); 5] = [("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp")];
/// The extensions the attach dialog offers.
pub const EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];

/// Reads an image file. The error says why it cannot be sent, as the Electron app's toast does.
pub fn read(path: &Path) -> Result<ImageAttachment, String> {
    let name = path.file_name().map_or_else(|| "This file".to_owned(), |n| n.to_string_lossy().into_owned());
    let extension = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let Some((_, media_type)) = TYPES.iter().find(|(e, _)| *e == extension) else {
        return Err(format!("{name} is not a PNG, JPEG, GIF or WebP image."));
    };
    let size = std::fs::metadata(path).map_err(|e| format!("{name} could not be read: {e}"))?.len();
    if size > MAX_IMAGE_BYTES {
        return Err(format!("{name} is larger than {} MB.", MAX_IMAGE_BYTES / 1024 / 1024));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("{name} could not be read: {e}"))?;
    Ok(ImageAttachment { media_type: (*media_type).to_owned(), data: base64::encode(&bytes) })
}

/// A pasted image, such as a screenshot, which the clipboard holds as PNG.
pub fn from_png(png: &[u8]) -> Result<ImageAttachment, String> {
    if png.len() as u64 > MAX_IMAGE_BYTES {
        return Err(format!("The pasted image is larger than {} MB.", MAX_IMAGE_BYTES / 1024 / 1024));
    }
    Ok(ImageAttachment { media_type: "image/png".into(), data: base64::encode(png) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_other_files_and_reads_an_image() {
        let dir = std::env::temp_dir().join(format!("desk-attach-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (text, png) = (dir.join("notes.txt"), dir.join("shot.PNG"));
        std::fs::write(&text, "hi").unwrap();
        std::fs::write(&png, [137, 80, 78, 71]).unwrap();
        assert_eq!(read(&text).unwrap_err(), "notes.txt is not a PNG, JPEG, GIF or WebP image.");
        let image = read(&png).unwrap();
        assert_eq!((image.media_type.as_str(), image.data.as_str()), ("image/png", "iVBORw=="));
        let _ = std::fs::remove_dir_all(dir);
    }
}
