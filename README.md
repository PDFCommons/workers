# @pdfcommons/workers

PDF tools that run on bytes you already have. The page reader in this repository is ours. It does not upload the file.

[PDF Commons](https://www.pdfcommons.com) is the hosted workbench. PDF to Word and the other server jobs run there. They are not in this package.

## The reader

`countPages` walks the page tree. Classic cross-reference tables, cross-reference streams, object streams, FlateDecode, and a PNG predictor are parsed by `src/core/pdf.ts`. The same reader is in `wasm/`, which links flate2 for zlib and does not link another PDF library.

```ts
import { countPages } from "@pdfcommons/workers/core";

const pages = await countPages(bytes);
```

| Input | Result |
| --- | --- |
| A readable page tree | The number of `/Type /Page` objects. An empty tree returns `0`. |
| Empty bytes, or bytes that are not a PDF | Throws `This PDF could not be read.` |
| A trailer with `/Encrypt` | Throws `This PDF could not be read.` The reader does not try a password. |

```rust
let pages = pdfcommons_wasm::page_count(&bytes)?;
```

`pdfcommons_page_count` is the C export. It returns the count, or `-1` when the pointer is null, the length is zero, or the bytes are not a PDF. The caller keeps the buffer.

```bash
node --experimental-strip-types --test src/core/pdf.test.ts
cargo test --manifest-path wasm/Cargo.toml
cargo build --manifest-path wasm/Cargo.toml --target wasm32-unknown-unknown --release
```

The design of the reader, and the issue trackers we read before writing it, are in [docs/core.md](docs/core.md) and [docs/sources.md](docs/sources.md).

## Tools that still call another library

The other files in `src/` import pdf-lib, pdf.js, or qpdf. They are here so the current tools keep their tests. New parsing goes into `src/core`. A tool leaves those imports when the same behavior runs on this reader.

Page numbers are 1-based unless a function says otherwise. These functions throw an `Error`. They do not return a status code. A locked file is not guessed. `unlockPdf` needs the password you already have.

| Import | Call | What it does |
| --- | --- | --- |
| `@pdfcommons/workers` | `mergePdfs` | One PDF after another. |
| `@pdfcommons/workers` | `splitPdf` | One PDF per page. |
| `@pdfcommons/workers` | `extractPdfRanges` | One PDF per inclusive range. A range longer than 500 pages is refused. |
| `@pdfcommons/workers` | `rotatePdf`, `rotatePdfPages` | Quarter turns. `0`, `90`, `180`, and `270` are the only angles. |
| `@pdfcommons/workers` | `deletePdfPages`, `reorderPdf`, `organizePdf` | Delete, reorder, or both. At least one page stays. A page is listed once. |
| `@pdfcommons/workers` | `addPageNumbers` | Draws the integer, starting at a whole number from 1 to 999999. |
| `@pdfcommons/workers` | `addWatermark` | One to 80 characters, drawn into the content. |
| `@pdfcommons/workers` | `imagesToPdf` | One JPEG or PNG per page, at the image's pixel size. |
| `@pdfcommons/workers` | `compressPdf` | Object streams. It does not downsample images. |
| `@pdfcommons/workers` | `pageCount` | The owned reader above. |
| `@pdfcommons/workers` | `protectPdf`, `unlockPdf` | qpdf, AES-256. You supply the password. |
| `@pdfcommons/workers/delete-page` | `deletePdfPage` | Removes one page. |
| `@pdfcommons/workers/keep-range` | `keepPdfRange` | Keeps an inclusive range. |
| `@pdfcommons/workers/rotate90` | `rotatePdf90` | Adds 90 degrees to every rotation flag. The media box stays. |
| `@pdfcommons/workers/page-x-of-y` | `addPageXofY` | Draws `Page N of M` and leaves text that was already there. |
| `@pdfcommons/workers/resize-legal` | `resizePdfLegal` | Fits each page inside 612 by 1008 points. |
| `@pdfcommons/workers/set-title` | `setPdfTitle` | Writes the info Title, at most 200 characters. Author and XMP stay. |
| `@pdfcommons/workers/links` | `removePdfLinks` | Removes Link annotations. Other annotations and widgets stay. |
| `@pdfcommons/workers/split-every` | `splitEveryN` | A zip of `part-1.pdf`, `part-2.pdf`, and so on. |
| `@pdfcommons/workers/drop-last` | `dropLastPdfPage` | Drops the last page. A one-page file is refused. |
| `@pdfcommons/workers/keep-first-last` | `keepFirstLastPdf` | Keeps the first and the last page. A one-page file stays one page. |
| `@pdfcommons/workers/swap` | `swapPdfPages` | Exchanges two pages. The same page twice is refused. |
| `@pdfcommons/workers/blank-every` | `blankEveryN` | Inserts a blank of the same media-box size after every Nth page. |
| `@pdfcommons/workers/one-page` | `onePagePdfs` | A zip of `page-1.pdf` onward, one page in each file. |
| `@pdfcommons/workers/blank` | `addBlankPage` | Inserts one blank. `0` means in front of page 1. |
| `@pdfcommons/workers/crop` | `cropPdf` | Insets the crop box. The content outside the box stays in the file. |
| `@pdfcommons/workers/metadata` | `removePdfMetadata` | Clears info-dictionary keys and the catalog metadata stream. |
| `@pdfcommons/workers/info` | `removePdfInfo` | Clears info-dictionary keys. The catalog metadata stream stays. |
| `@pdfcommons/workers/raster` | `rasterizePdf` | Draws up to 30 pages into a canvas you pass in. |
| `@pdfcommons/workers/resize` | `resizePdf` | Fits each page on Letter or A4. Rotation is applied. |
| `@pdfcommons/workers/text` | `pdfToText` | The text layer. A scan with no text layer is refused. This is not OCR. |
| `@pdfcommons/workers/two-up` | `twoUpPdf` | Two pages on a landscape Letter or A4 sheet. |
| `@pdfcommons/workers/four-up` | `fourUpPdf` | Four pages on a portrait Letter or A4 sheet. |
| `@pdfcommons/workers/booklet` | `bookletPdf` | A saddle-fold imposition on landscape Letter or A4. |
| `@pdfcommons/workers/flatten` | `flattenPdf` | Burns form appearances and removes the form. |
| `@pdfcommons/workers/reverse` | `reversePdf` | Reverses the page order. |
| `@pdfcommons/workers/scale` | `scalePdf` | Scales every page by 50, 75, 150, or 200 percent. |
| `@pdfcommons/workers/annotations` | `removePdfAnnotations` | Removes annotations other than widgets. |
| `@pdfcommons/workers/duplicate` | `duplicatePdfPage` | Inserts a copy of one page after that page. |
| `@pdfcommons/workers/odd-even` | `oddEvenPdf` | Keeps the odd or the even pages. |
| `@pdfcommons/workers/interleave` | `interleavePdf` | Alternates two PDFs. `reverse` flips the second file first. |
| `@pdfcommons/workers/orient` | `orientPdf` | Sets portrait or landscape with the rotation flag. The media box stays. |
| `@pdfcommons/workers/bookmarks` | `removePdfBookmarks` | Deletes the outline. Page text, links, and the info dictionary stay. |

Sentences you can match on:

| Sentence | When |
| --- | --- |
| `This PDF could not be read.` | Empty or unreadable bytes. |
| `This PDF has no pages.` | The page tree is empty. |
| `Name a page that exists.` | A page number is missing or not a whole number in range. |
| `A PDF needs at least one page.` | The edit would leave nothing. |
| `Expected instance of PDFDict, but got instance of undefined` | pdf-lib's own message for a file it cannot open. We rethrow it. |
| `Enter the password you already know.` | `unlockPdf` was given an empty password. |
| `That password did not open this PDF.` | qpdf rejected the password. |
| `Choose a password.` | `protectPdf` was given an empty password. |

```bash
npm install
node --experimental-strip-types --test src/*.test.ts
```

Node tests that rasterize use `@napi-rs/canvas`. A browser passes its own canvas to `rasterizePdf`. Neither path uploads the PDF.

## License

MIT. See [LICENSE](LICENSE).

Commits in this repository are authored as PDF Commons `<workers@pdfcommons.com>`.
