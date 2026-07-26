import io
import zipfile

import pytest

from compagnon.archive_security import validate_zip


def make_zip(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in entries:
            zf.writestr(name, content)
    buf.seek(0)
    return zipfile.ZipFile(buf)


def test_accepts_normal_addon_archive():
    with make_zip([("MyAddon/MyAddon.toc", "## Version: 1.0"), ("MyAddon/Core.lua", "")]) as zf:
        validate_zip(zf)


@pytest.mark.parametrize("name", ["../evil.txt", "folder/../../evil.txt", "C:/evil.txt", "/tmp/evil.txt"])
def test_rejects_path_traversal(name):
    with make_zip([(name, "boom")]) as zf:
        with pytest.raises(ValueError):
            validate_zip(zf)
