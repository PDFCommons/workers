# @pdfcommons/workers

In-browser PDF tools for [PDF Commons](https://www.pdfcommons.com). MIT.

Merge, split, rotate, reorder, delete pages, JPEG/PNG to PDF, PDF to JPEG/PNG, basic compress, password protect, unlock, PDF to text, add blank page, and crop run on bytes you pass in. Page rasterizing draws each page in the caller-supplied canvas. Unlock only removes a password the caller supplies. This package does not guess passwords and does not upload the file.

```bash
node --experimental-strip-types --test src/*.test.ts
```

PDF to Word is a server job in the private app, not in this package. Rasterizing imports `./raster` and needs a canvas. PDF to text imports `./text`, reads the text layer, and does not OCR. Add blank page imports `./blank` and inserts one empty page. Crop imports `./crop` and insets the crop box. It does not delete hidden marks. Node tests use `@napi-rs/canvas`. The browser uses its own canvas. Neither path uploads the PDF.
