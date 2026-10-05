# @pdfcommons/workers

In-browser PDF tools for [PDF Commons](https://www.pdfcommons.com). MIT.

Merge, split, rotate, reorder, delete pages, JPEG/PNG to PDF, PDF to JPEG/PNG, basic compress, password protect, and unlock run on bytes you pass in. Page rasterizing draws each page in the caller-supplied canvas. Unlock only removes a password the caller supplies. This package does not guess passwords and does not upload the file.

```bash
node --experimental-strip-types --test src/*.test.ts
```

PDF to Word is a server job in the private app, not in this package. Rasterizing imports `./raster` and needs a canvas. Node tests use `@napi-rs/canvas`. The browser uses its own canvas. Neither path uploads the PDF.
