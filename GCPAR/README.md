# GCPAR — Arabic video lecture: *Commanding Google Compute Engine*

This folder turns the 19-slide deck *Commanding the Cloud with Google Compute
Engine* into an Arabic narrated video lecture. The narration uses the
instructor's cloned voice, and a lip-synced instructor window sits in the
bottom-left corner.

```
┌──────────────┬────────────────────────────────────────────┐
│ course title │                                            │
│ 03 / 19      │              slide (1500×837)              │
│ section      │                                            │
│ ▬▬▬▬▬▬ dots  │                                            │
│ [ up next ]  │                                            │
│ ● waveform   ├────────────────────────────────────────────┤
│ ┌──────────┐ │        Arabic subtitles (synced)           │
│ │instructor│ │                                            │
│ └──────────┘ │                                            │
└──────────────┴────────────────────────────────────────────┘
```

## Layout of this folder

| Path | What it is |
|---|---|
| `narration/narration_ar.json` | Arabic narration script: one entry per slide (section title and spoken text), plus the course, intro and outro strings |
| `scripts/01_prepare_assets.sh` | Extracts the slides from the .pptx, cleans the voice sample, crops the instructor photo and fetches the fonts |
| `scripts/extract_slides.py` | Exports each slide's full-bleed picture, in presentation order |
| `scripts/split_audio_chunks.py` | Cuts each slide's narration at natural pauses into chunks of 14.5 s or less, sized for the lip-sync model |
| `scripts/put_upload.sh` | PUTs a file to a presigned Higgsfield upload URL |
| `scripts/build_video.py` | The compositor: layout, subtitles, waveform, instructor window, intro and outro cards, crossfades |
| `work/` *(git-ignored)* | Intermediate assets (slides, audio, clips, build files) |
| `output/` | The final MP4 |

## Pipeline

1. **Assets**
   ```bash
   scripts/01_prepare_assets.sh deck.pptx voice.m4a instructor.jpg
   ```
2. **Voice clone and narration** (Higgsfield MCP tools)
   - Upload `work/src/voice_sample_clean.mp3` with `media_upload` and
     `scripts/put_upload.sh`, then call `media_confirm`.
   - Create the voice with `create_voice_from_confirmed_audio`.
   - For each slide, generate speech with `generate_audio`
     (`elevenlabs_v4_turbo`, the cloned voice with `voice_type: element`).
     Save the results as `work/audio/slideNN.mp3`.
3. **Lip-synced instructor**
   ```bash
   python3 scripts/split_audio_chunks.py   # -> work/audio_chunks/*.mp3 + manifest.json
   ```
   For each chunk, call `generate_video` with `wan2_7` at 720p and 3:4. Pass
   `work/src/instructor_3x4.jpg` as `start_image` and the chunk as
   `audio_references`. Save the clips as `work/pip/slideNN_partK.mp4`.
4. **Render**
   ```bash
   python3 scripts/build_video.py              # -> output/GCP_Compute_Engine_AR.mp4
   python3 scripts/build_video.py --preview    # placeholder voice, to check layout and timing
   python3 scripts/build_video.py --only 3     # re-render a single slide segment
   ```
   If a slide has no lip-sync clips, the instructor window shows the photo
   with a slow "breathing" zoom instead, so the video always renders.

## Requirements

- `ffmpeg`, Python 3 with Pillow built against libraqm (for Arabic shaping and
  bidi). On Ubuntu: `apt-get install libraqm0`.
- Network access to `upload.higgsfield.ai` and Higgsfield's CDN hosts, used to
  upload the voice sample and photo and to download the generated audio and
  clips.
- Fonts: IBM Plex Sans Arabic and Cairo, both under the SIL Open Font License.
  `01_prepare_assets.sh` downloads them from the `google/fonts` repository.

## Editing the narration

Change the text in `narration/narration_ar.json`, regenerate that slide's audio
and clips, then run `build_video.py`. Subtitles are split at punctuation and
timed to the pauses in the audio automatically. Numbers are written out in
words so the TTS pronounces them correctly. Product names stay in English.
