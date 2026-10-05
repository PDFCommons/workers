/// Number of pages in a PDF. The bytes stay in the caller. This function does not upload them.
pub fn page_count(bytes: &[u8]) -> Result<u32, String> {
    let doc = lopdf::Document::load_mem(bytes).map_err(|error| error.to_string())?;
    Ok(doc.get_pages().len() as u32)
}

#[no_mangle]
pub extern "C" fn pdfcommons_page_count(ptr: *const u8, len: usize) -> i32 {
    if ptr.is_null() || len == 0 {
        return -1;
    }
    // The caller keeps `ptr` alive for `len` bytes. This reads that buffer and does not free it.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    match page_count(bytes) {
        Ok(count) => count as i32,
        Err(_) => -1,
    }
}

#[cfg(test)]
mod tests {
    use super::page_count;

    #[test]
    fn counts_one_page() {
        let bytes = include_bytes!("../fixtures/one-page.pdf");
        assert_eq!(page_count(bytes).unwrap(), 1);
    }

    #[test]
    fn counts_two_pages() {
        let bytes = include_bytes!("../fixtures/two-page.pdf");
        assert_eq!(page_count(bytes).unwrap(), 2);
    }

    #[test]
    fn rejects_empty_bytes() {
        assert!(page_count(&[]).is_err());
    }
}
