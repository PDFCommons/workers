# The reader in this repository

`src/core/pdf.ts` and `wasm/src/lib.rs` parse PDF bytes with code that lives in this repository. They do not import pdf-lib, pdf.js, qpdf, or lopdf.

```ts
import { countPages } from "@pdfcommons/workers/core";

const pages = await countPages(bytes);
```

`countPages` walks `/Type /Page` objects under the catalog's `/Pages` tree. It reads:

- a classic `xref` table, including a `/Prev` chain where the newest entry wins
- a `/Type /XRef` stream with `/W` and `/Index`
- `/Type /ObjStm` object streams
- `/Filter /FlateDecode`, inflated with the platform `DecompressionStream` in JavaScript and with flate2 in Rust
- a PNG predictor (`/Predictor` 10 or higher) on those streams

An `/Encrypt` entry in the trailer throws `This PDF could not be read.` The reader does not try a password. Empty bytes and bytes without a `%PDF-` header in the first 1024 bytes throw the same sentence. A page tree that is present and empty returns 0.

The Rust function is `page_count`. The C export `pdfcommons_page_count` returns that count, or `-1` for an empty or unreadable buffer. The caller keeps the buffer.

```bash
node --experimental-strip-types --test src/core/pdf.test.ts
cargo test --manifest-path wasm/Cargo.toml
cargo build --manifest-path wasm/Cargo.toml --target wasm32-unknown-unknown --release
```

flate2 is a zlib implementation. It is the only library the wasm crate links. The PDF grammar above it is ours.

The modules next to `src/core` still import pdf-lib, pdf.js, or qpdf. Those calls are the remaining dependency. A tool moves when its behavior is reimplemented on this reader and the old import is deleted.
