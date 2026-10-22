# Supported formats

Detection is by **file signature** (`packages/core/file-types/signatures.ts`). Capabilities are
detected **at runtime** (`apps/desktop/src/main/capabilities.ts`, Settings → Diagnostics), and
actions this machine cannot run are hidden from the wheel.

## Images (sharp 0.35 / libvips 8.18 + built-in BMP codec)

| Format | Read | Write | Notes |
|---|---|---|---|
| PNG | ✅ | ✅ | Transparency preserved. Compress = palette quantization. |
| JPEG | ✅ | ✅ | mozjpeg when compressing; transparency flattened onto white. |
| WebP | ✅ | ✅ | |
| AVIF | ✅ | ✅ | libheif + aom. |
| TIFF | ✅ | ✅ | |
| BMP | ✅ | ✅ | Built-in codec (`core/image/bmp.ts`): 1/4/8/16/24/32-bit, bitfields, top-down. RLE rejected. Output 24-bit, or 32-bit with alpha. Verified readable by FFmpeg. |
| GIF | ✅ first frame | ❌ | |
| HEIC/HEIF (HEVC) | ✅ via FFmpeg | ❌ | Decoded to lossless PNG by FFmpeg (tile grids composed, rotation applied). Verified on a 2×2 grid and a 45 MP CC0 camera sample. Needs FFmpeg with HEVC. |

EXIF orientation is always applied. Metadata is kept on conversions and edits (orientation reset).
**Strip metadata**, **Redact** and Metadata → Remove produce copies with no EXIF/XMP/IPTC/ICC.

## PDF

| Action | Engine | Notes |
|---|---|---|
| Pages → PNG/JPG | pdf.js in a hidden window | 150 dpi, capped at 40 MP per page; white page background. |
| Extract text | pdf.js | No OCR. |
| Merge, split, rotate, optimize, page editor (incl. crop → CropBox) | pdf-lib | Optimize = structural only. |
| Compress | pdf-lib + sharp | Recompresses embedded images; see known-issues P7. |
| → DOCX | pdf.js layout + own OOXML writer | Paragraphs, headings, page breaks. Verified by opening in Microsoft Word. |
| Images → PDF | sharp + pdf-lib | One page per image at pixel size. |
| Encrypted PDFs | — | Reported as password-protected. |

## Documents, text, archives, folders

| Input | Actions | Notes |
|---|---|---|
| DOCX/DOC/RTF/ODT, XLSX/XLS/ODS, PPTX/PPT/ODP | → PDF | Through the installed Office app (Word/Excel/PowerPoint via COM, paths passed in environment variables), else LibreOffice. Word verified in tests; Excel/PowerPoint paths not yet tested. |
| DOCX/PPTX/XLSX/ODF | Extract images | Copies `word/media`, `ppt/media`, `xl/media`, `Pictures/` entries as-is. |
| PDF | Extract images | JPEG/JPEG 2000 copied byte-for-byte; 8-bit RGB/gray → PNG (soft mask kept as alpha); other encodings skipped and counted. |
| DOCX, PDF, TXT/CSV/JSON/LOG/XML/YAML/INI | → Markdown | DOCX: own reader (no Office needed): headings (style names, so localized styles work), bold/italic/strike, monospace → code, bulleted/numbered lists with levels, tables (merged cells kept aligned; one-cell layout boxes become text), links (incl. HYPERLINK fields), footnotes/endnotes, images copied to `<name>-images/` and linked. Tracked deletions dropped. Not read: .doc/.rtf/.odt, text boxes, comments, equations. PDF: same paragraph rebuild as → DOCX, bullet glyphs become lists, no OCR. TXT keeps its line breaks; CSV becomes a table; data files a fenced code block. Mixed selections work. |
| DOCX, PDF, any text file | Count words | Words, characters, reading time (230 wpm); copied to the clipboard, totals for several files. |
| TXT/MD/CSV/JSON/LOG/XML/YAML/INI | → PDF, → DOCX, Combine | PDF embeds Segoe UI (Consolas for data formats), so Unicode renders; Markdown headings and bullets understood. Legacy Windows-1252 files decoded. |
| ZIP | Extract here | yauzl; rejects path traversal, symlinks, password-protected entries, > 100k entries, and archives claiming > 20 GB or > 200:1 expansion. Single top-level folder is recreated, not nested. |
| 7z / RAR | — | Detected; extraction not supported yet. |
| Folder | ZIP, images → PDF, copy path | Symlinks/junctions are never followed when zipping. |
| Anything | Copy path, SHA-256 (files), ZIP | Paths/checksums go to the clipboard. |

## Audio / video (FFmpeg on PATH; dev machine: 9.0.2 full build)

| Action | Encoders required |
|---|---|
| → MP4 / Compress / Trim & export | libx264, aac |
| → WEBM | libvpx-vp9, libopus |
| → GIF | gif (palettegen/paletteuse) |
| Extract audio | stream copy for AAC/MP3; else libmp3lame |
| → MP3 / M4A / WAV / FLAC / OGG | libmp3lame / aac / pcm_s16le / flac / libvorbis |
| Normalize | loudnorm (EBU R128, −16 LUFS), same container |
| Shrink for Messenger 25 MB / Discord 10 MB | Two-pass libx264 + AAC at a bitrate computed from length; steps down to 720p/480p/360p when needed; verified under target, one automatic retry. |

Inputs: anything FFmpeg/ffprobe can read that is detected as audio or video (MP4/MOV/MKV/WEBM/AVI,
MP3/WAV/FLAC/OGG/M4A/AAC).
