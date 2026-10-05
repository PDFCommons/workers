# @pdfcommons/workers

In-browser PDF tools for [PDF Commons](https://www.pdfcommons.com). MIT.

Merge, split, rotate, reorder, delete pages, JPEG/PNG to PDF, basic compress, password protect, and unlock run on bytes you pass in. Unlock only removes a password the caller supplies. This package does not guess passwords and does not upload the file.

```bash
node --experimental-strip-types --test src/*.test.ts
```

Page rasterizing is not in this version. PDF to Word is a server job in the private app, not in this package.
