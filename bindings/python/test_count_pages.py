"""Run from the repository root: python3 bindings/python/test_count_pages.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from count_pages import count_pages

ROOT = Path(__file__).resolve().parents[2]
ONE = (ROOT / "wasm" / "fixtures" / "one-page.pdf").read_bytes()
TWO = (ROOT / "wasm" / "fixtures" / "two-page.pdf").read_bytes()

assert count_pages(ONE) == 1
assert count_pages(TWO) == 2

try:
    count_pages(b"")
except ValueError as error:
    assert str(error) == "This PDF could not be read."
else:
    raise SystemExit("empty bytes should fail")

try:
    count_pages(b"hello")
except ValueError as error:
    assert str(error) == "This PDF could not be read."
else:
    raise SystemExit("plain text should fail")

print("python count_pages ok")
