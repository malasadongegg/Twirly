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

## Audio / video (FFmpeg on PATH; dev machine: 9.0.2 full build)

| Action | Encoders required |
|---|---|
| → MP4 / Compress / Trim & export | libx264, aac |
| → WEBM | libvpx-vp9, libopus |
| → GIF | gif (palettegen/paletteuse) |
| Extract audio | stream copy for AAC/MP3; else libmp3lame |
| → MP3 / M4A / WAV / FLAC / OGG | libmp3lame / aac / pcm_s16le / flac / libvorbis |
| Normalize | loudnorm (EBU R128, −16 LUFS), same container |

Inputs: anything FFmpeg/ffprobe can read that is detected as audio or video (MP4/MOV/MKV/WEBM/AVI,
MP3/WAV/FLAC/OGG/M4A/AAC).
