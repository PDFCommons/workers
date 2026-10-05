# @pdfcommons/workers

In-browser PDF tools for [PDF Commons](https://www.pdfcommons.com). MIT.

Commits in this repository are authored as PDF Commons <workers@pdfcommons.com>.

Merge, split, rotate, reorder, delete pages, JPEG/PNG to PDF, PDF to JPEG/PNG, basic compress, password protect, unlock, PDF to text, add blank page, crop, remove metadata, resize, two-up, flatten, reverse, scale, annotation removal, duplicate page, odd or even pages, info-dictionary removal, and orient run on bytes you pass in. Page rasterizing draws each page in the caller-supplied canvas. Unlock only removes a password the caller supplies. Delete one page imports `./delete-page` and removes that page. Keep an inclusive page range imports `./keep-range` and drops the other pages. Add 90 degrees to every rotation flag imports `./rotate90`. Draw Page X of Y at the bottom center imports `./page-x-of-y`. Fit each page on a US Legal sheet imports `./resize-legal`. Set the info Title imports `./set-title` and leaves author and XMP. Drop link annotations imports `./links` and keeps other annotations and widgets. Split into groups of at most N pages imports `./split-every` and downloads a zip. This package does not guess passwords and does not upload the file.

```bash
node --experimental-strip-types --test src/*.test.ts
```

PDF to Word is a server job in the private app, not in this package. Rasterizing imports `./raster` and needs a canvas. PDF to text imports `./text`, reads the text layer, and does not OCR. Add blank page imports `./blank` and inserts one empty page. Crop imports `./crop` and insets the crop box. It does not delete hidden marks. Remove metadata imports `./metadata` and clears the info dictionary and the catalog metadata stream. Page content stays. Resize imports `./resize` and fits each page inside Letter or A4. Two-up imports `./two-up` and places two pages on one landscape Letter or A4 sheet. It does not reorder pages into a booklet. Flatten imports `./flatten`, burns AcroForm appearances into the page, and removes the form. Other annotations stay. Reverse imports `./reverse` and flips page order inside the same document. Title, rotation, annotations, and form fields stay with their pages. Scale imports `./scale` and multiplies every page box, its drawing, and its annotations by 50, 75, 150, or 200 percent. It does not fit the page onto Letter or A4. Remove annotations imports `./annotations`, drops every annotation that is not a form widget, and keeps form widgets. It does not redact page text. Duplicate imports `./duplicate`, copies one page into the same document, and inserts it immediately after that page. It does not insert a blank page. Odd or even imports `./odd-even`, keeps one side of the pages in the same document, and drops the other side. It does not write a custom range. Interleave imports `./interleave`, alternates pages from two PDFs, and can reverse the second file first. It does not stack one file after the other. Info imports `./info` and deletes the info-dictionary keys. The catalog XMP stream stays. Four-up imports `./four-up`, places four pages on one portrait Letter or A4 sheet, and does not reorder them into a booklet. Booklet imports `./booklet`, imposes a saddle-fold on a landscape Letter or A4 sheet, and reorders pages so a duplex print folds into a booklet. Orient imports `./orient`, turns a page to portrait or landscape by setting the rotation flag, and leaves the media box. A square page stays. Bookmarks imports `./bookmarks`, deletes the outline tree, and leaves page text, links, and the info dictionary. Node tests use `@napi-rs/canvas`. The browser uses its own canvas. Neither path uploads the PDF.

## WebAssembly

`wasm/` builds a `wasm32-unknown-unknown` module. `page_count` counts the pages in bytes the caller already holds. The export `pdfcommons_page_count` returns that count, or `-1` when the bytes are empty or not a PDF. The module does not upload the file. The TypeScript workers above are what the site runs in the tab. The full set is at [pdfcommons.com](https://www.pdfcommons.com).

```bash
cargo test --manifest-path wasm/Cargo.toml
cargo build --manifest-path wasm/Cargo.toml --target wasm32-unknown-unknown --release
```
