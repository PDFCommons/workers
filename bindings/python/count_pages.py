"""Count PDF pages with the C export from this repository.

There is no PyPI package. Build the shared library first:

    cargo build --release --manifest-path wasm/Cargo.toml
"""

from __future__ import annotations

import ctypes
import os
from pathlib import Path

NO_READ = "This PDF could not be read."


def library_path() -> Path:
    env = os.environ.get("PDFCOMMONS_LIB")
    if env:
        return Path(env)
    release = Path(__file__).resolve().parents[2] / "wasm" / "target" / "release"
    for name in ("libpdfcommons_wasm.dylib", "libpdfcommons_wasm.so", "pdfcommons_wasm.dll"):
        candidate = release / name
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        "Build the library with: cargo build --release --manifest-path wasm/Cargo.toml"
    )


def count_pages(data: bytes) -> int:
    """Return the number of pages. Empty or unreadable bytes raise ValueError."""
    if not isinstance(data, (bytes, bytearray)) or len(data) == 0:
        raise ValueError(NO_READ)
    library = ctypes.CDLL(str(library_path()))
    function = library.pdfcommons_page_count
    function.argtypes = [ctypes.POINTER(ctypes.c_uint8), ctypes.c_size_t]
    function.restype = ctypes.c_int32
    buffer = (ctypes.c_uint8 * len(data)).from_buffer_copy(bytes(data))
    count = int(function(buffer, len(data)))
    if count < 0:
        raise ValueError(NO_READ)
    return count
