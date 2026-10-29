"""Read the downloadable V10 archive with Python's independent ZIP implementation."""

from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
import stat
from zipfile import ZipFile


root = Path(__file__).resolve().parents[1]
release = root / "release/SIDEWAYS-v10-pages.zip"
hosted = root / "dist/downloads/SIDEWAYS-v10-pages.zip"
data = release.read_bytes()
assert data == hosted.read_bytes(), "Release and hosted download bytes differ"
assert len(data) < 64 * 1024 * 1024, "Archive exceeds the download page's size guard"

with ZipFile(BytesIO(data)) as archive:
    names = archive.namelist()
    assert len(names) == len(set(names)), "Duplicate archive paths"
    assert archive.testzip() is None, "An archive entry failed its CRC check"
    assert {"index.html", "SIDEWAYS.html", "downloads.html", ".nojekyll", "package-manifest.json"} <= set(names)
    assert not any(name.lower().endswith(".zip") or name.startswith("downloads/") for name in names), "Recursive download archive"
    for item in archive.infolist():
        path = PurePosixPath(item.filename)
        assert not path.is_absolute() and ".." not in path.parts and "\\" not in item.filename
        assert not item.is_dir(), "The archive contract uses regular files only"
        assert stat.S_ISREG(item.external_attr >> 16), "Unexpected file type"

    manifest = json.loads(archive.read("package-manifest.json"))
    assert manifest["version"] == 10
    assert manifest["engineSdk"] == {"version": "1.6.0", "physicsRelease": 14, "audioRelease": 14}
    assert set(manifest["files"]) == set(names) - {"package-manifest.json"}
    compared_runtime_files = 0
    for name, expected in manifest["files"].items():
        raw = archive.read(name)
        assert len(raw) == expected["bytes"], f"Uncompressed length differs: {name}"
        assert sha256(raw).hexdigest() == expected["sha256"], f"Manifest hash differs: {name}"
        runtime_file = root / "dist" / name
        if runtime_file.is_file():
            assert raw == runtime_file.read_bytes(), f"Archive contains stale runtime bytes: {name}"
            compared_runtime_files += 1

    offline = archive.read("SIDEWAYS.html")
    assert len(offline) < 64 * 1024 * 1024
    assert b"sidewaysDiagnostics" in offline[-4096:] and b"</html>" in offline[-4096:]
    assert b"MotorLab SDK 1.6." in offline

report = {
    "status": "passed",
    "reader": "Python standard-library zipfile, independent of the JavaScript writer",
    "archive": str(release.relative_to(root)),
    "hostedArchive": str(hosted.relative_to(root)),
    "bytes": len(data),
    "sha256": sha256(data).hexdigest(),
    "entries": len(names),
    "currentRuntimeFilesCompared": compared_runtime_files,
    "checks": [
        "Standard-library central-directory parsing, decompression and CRC check pass for every entry.",
        "Hosted and release ZIP files are byte-for-byte identical.",
        "The manifest covers every packaged file with matching uncompressed size and SHA-256.",
        "Packaged runtime bytes match the current dist files, including standalone HTML and the SDK.",
        "The archive contains root index.html and .nojekyll with no nested download archives.",
        "All archive paths are relative regular files without traversal or duplicate names.",
        "HTML and ZIP sizes fit the download page guard and the offline HTML contains the V10 SDK.",
    ],
    "limits": ["This checks actual file bytes; it does not start a browser download or publish the archive."],
}
(root / "qa/zip-v10-results.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
