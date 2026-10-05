# Issues we read in other PDF projects

On 2026-10-05 we read open issues in the projects people already use for PDF work. We used that reading to change this repository. Page count had been going through pdf-lib in `src/index.ts` and through lopdf in `wasm/`. Both of those calls are gone. `countPages` and `page_count` are the reader described in [core.md](core.md).

We did not copy those projects' source. We did not close their tickets. An issue marked **Open** is still work for this reader. An issue marked **Out of scope** is a server, deploy, or HTML-renderer bug that this library does not take on.

The older tool modules still import pdf-lib, pdf.js, or qpdf. That is temporary. The issue list is the order of work for replacing those imports.

## Hopding/pdf-lib

| Issue | What was filed | Here |
| --- | --- | --- |
| [#1657](https://github.com/Hopding/pdf-lib/issues/1657) | How do I compress a PDF? | **Open.** `compressPdf` still rewrites object streams through pdf-lib and does not downsample images. |
| [#1662](https://github.com/Hopding/pdf-lib/issues/1662) | Copying a page keeps unused images. | **Open.** Merge and split still use pdf-lib's page copy. |
| [#1670](https://github.com/Hopding/pdf-lib/issues/1670) | Fillable fields are not found. | **Open.** This reader does not fill forms. |
| [#1692](https://github.com/Hopding/pdf-lib/issues/1692) | `JSON.stringify` hits a circular structure. | **Open.** Password protect and unlock still call qpdf. |
| [#1784](https://github.com/Hopding/pdf-lib/issues/1784) | `removeField()` leaves a widget on the page. | **Open.** We do not remove fields yet. Link removal and annotation removal are still the pdf-lib tools. |

## J-F-Liu/lopdf

| Issue | What was filed | Here |
| --- | --- | --- |
| [#408](https://github.com/J-F-Liu/lopdf/issues/408) | lopdf 0.36 does not compile for `wasm32-unknown-unknown`. | **Covered.** The wasm crate no longer depends on lopdf, so that build break is not ours. `cargo build --target wasm32-unknown-unknown --release` compiles this reader. |
| [#424](https://github.com/J-F-Liu/lopdf/issues/424) | Merging in lopdf 0.35 breaks some files in Adobe. | **Open.** Merge is still the pdf-lib tool. The owned reader does not merge yet. |
| [#452](https://github.com/J-F-Liu/lopdf/issues/452) | `replace_text` fails. | **Open.** This reader does not rewrite page content. |

## LibPDF-js/core

| Issue | What was filed | Here |
| --- | --- | --- |
| [#42](https://github.com/LibPDF-js/core/issues/42) | Operations drop the outline tree. | **Open.** Bookmark removal is intentional and still uses pdf-lib. Merge does not yet promise to keep outlines. |
| [#69](https://github.com/LibPDF-js/core/issues/69) | Encrypted linearized files throw instead of reporting that a password is required. | **Narrower.** A trailer with `/Encrypt` throws `This PDF could not be read.` We do not guess the password, and we do not yet return a structured "needs a password" result. |
| [#81](https://github.com/LibPDF-js/core/issues/81) | `getMediaBox()` treats the far corner as the width when the origin is not zero. | **Open.** The reader counts pages and does not return boxes yet. |
| [#13](https://github.com/LibPDF-js/core/issues/13) | Need a sample of resizing a page that has annotations. | **Open.** Resize still uses pdf-lib. It fits the rotated page by swapping media-box axes for 90 and 270 degrees, because pdf-lib's `getWidth` ignores `/Rotate`. |

## py-pdf/pypdf

| Issue | What was filed | Here |
| --- | --- | --- |
| [#3933](https://github.com/py-pdf/pypdf/issues/3933) | Detect and remove embedded JavaScript. | **Open.** |
| [#3978](https://github.com/py-pdf/pypdf/issues/3978) | Text extraction drops spaces for some composite fonts. | **Open.** `pdfToText` still asks pdf.js for the text layer. |
| [#3549](https://github.com/py-pdf/pypdf/issues/3549) | Radio buttons lose their value in Acrobat. | **Open.** |
| [#3418](https://github.com/py-pdf/pypdf/issues/3418) | Removing a page leaves unused objects behind. | **Open.** |

## qpdf/qpdf

| Issue | What was filed | Here |
| --- | --- | --- |
| [#1434](https://github.com/qpdf/qpdf/issues/1434) | Remove a password. | **Narrower.** `unlockPdf` still calls qpdf, and only with the password the caller already has. |
| [#1405](https://github.com/qpdf/qpdf/issues/1405) | XMP metadata support. | **Narrower.** `removePdfInfo` clears info-dictionary keys and leaves the catalog metadata stream. `removePdfMetadata` clears both. Neither writes new XMP. Both still use pdf-lib. |
| [#1327](https://github.com/qpdf/qpdf/issues/1327) | A widget is not reachable from `/AcroForm`. | **Open.** |

## pdfcpu/pdfcpu

| Issue | What was filed | Here |
| --- | --- | --- |
| [#1078](https://github.com/pdfcpu/pdfcpu/issues/1078) | Japanese text needs a real font, not a missing glyph. | **Open.** |
| [#1126](https://github.com/pdfcpu/pdfcpu/issues/1126) | Booklet output should match pdfbook2. | **Narrower.** `bookletPdf` still uses pdf-lib. It imposes a saddle fold on a landscape Letter or A4 sheet. |
| [#1161](https://github.com/pdfcpu/pdfcpu/issues/1161) | A stamp or watermark drops an annotation. | **Open.** The watermark tool draws into the content stream through pdf-lib. |
| [#1187](https://github.com/pdfcpu/pdfcpu/issues/1187) | Duplicate bookmark titles point at the wrong page. | **Open.** |

## pikepdf/pikepdf

| Issue | What was filed | Here |
| --- | --- | --- |
| [#62](https://github.com/pikepdf/pikepdf/issues/62) | The docs need examples of the real calls. | **Covered** for page count. [core.md](core.md) and the README show the call, the error sentence, and the build commands. The other tools still need the same treatment as they move onto this reader. |
| [#281](https://github.com/pikepdf/pikepdf/issues/281) | Merging should keep internal links. | **Open.** |
| [#118](https://github.com/pikepdf/pikepdf/issues/118) | Merging should keep optional-content layers. | **Open.** |
| [#461](https://github.com/pikepdf/pikepdf/issues/461) | Tagged PDF. | **Open.** |

## mozilla/pdf.js

We use pdf.js for the text layer and for rasterizing. These viewer bugs stay upstream until a tool no longer imports pdf.js.

| Issue | What was filed | Here |
| --- | --- | --- |
| [#21890](https://github.com/mozilla/pdf.js/issues/21890) | `getTextContent` inserts a space after some Indic glyphs. | **Open.** |
| [#22023](https://github.com/mozilla/pdf.js/issues/22023) | XFA rich text breaks on bold and italic. | **Open.** |
| [#21904](https://github.com/mozilla/pdf.js/issues/21904) | Text in a form field is not saved. | **Open.** |
| [#22010](https://github.com/mozilla/pdf.js/issues/22010) | Text at a zoom below 100% looks worse than in other renderers. | **Out of scope.** This package does not ship a viewer. |

## Stirling-Tools/Stirling-PDF

Stirling-PDF is a server. These issues are about that server. This library never starts one, and it does not upload the file.

| Issue | What was filed | Here |
| --- | --- | --- |
| [#8240](https://github.com/Stirling-Tools/Stirling-PDF/issues/8240) | S3 retries fail when the stream cannot rewind. | **Out of scope.** |
| [#8330](https://github.com/Stirling-Tools/Stirling-PDF/issues/8330) | A release's API routes time out inside an LXC container. | **Out of scope.** |
| [#8321](https://github.com/Stirling-Tools/Stirling-PDF/issues/8321) | Merge fails in the server. | **Out of scope** for their deploy. Our merge is still the pdf-lib tool, tracked under lopdf #424 and pdf-lib #1662. |
| [#8204](https://github.com/Stirling-Tools/Stirling-PDF/issues/8204) | The file sidebar needs a Clear all button. | **Out of scope.** |

## parallax/jsPDF

jsPDF's `html()` renderer is a different product. We do not wrap it.

| Issue | What was filed | Here |
| --- | --- | --- |
| [#3428](https://github.com/parallax/jsPDF/issues/3428) | Multi-page HTML output breaks in Adobe Reader. | **Out of scope.** |
| [#3376](https://github.com/parallax/jsPDF/issues/3376) | An image fails to appear. | **Open** for our own image embedding, which still uses pdf-lib. |
| [#3318](https://github.com/parallax/jsPDF/issues/3318) | Large phone JPEGs are corrupted. | **Open.** `imagesToPdf` still embeds through pdf-lib. |
