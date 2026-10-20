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
| `scripts/make_tts_chunks.py` | Splits the narration into sentence-aligned chunks of 150 characters or less (12 s or less of speech), each driving one lip-sync clip |
| `narration/tts_chunks.json` | The 50 chunks that were narrated |
| `scripts/assemble_audio.py` | Joins the narrated chunks into one track per slide, keeping lip-synced chunks aligned with their clips |
| `scripts/split_audio_chunks.py` | Alternative for whole-slide audio: cuts it at pauses into chunks of 14.5 s or less |
| `scripts/put_upload.sh` | PUTs a file to a presigned Higgsfield upload URL |
| `scripts/build_video.py` | The compositor: layout, subtitles, waveform, instructor window, intro and outro cards, crossfades |
| `work/` *(git-ignored)* | Intermediate assets (slides, audio, clips, build files) |
| `output/` | The final MP4 |

## Pipeline

1. **Assets**
   ```bash
   scripts/01_prepare_assets.sh deck.pptx voice.m4a instructor.jpg
   ```
2. **Voice clone** (Higgsfield MCP tools): upload `work/src/voice_sample_clean.mp3`
   (`media_upload` + `scripts/put_upload.sh` + `media_confirm`), then
   `create_voice_from_confirmed_audio`. The resulting voice is used with
   `voice_type: element`.
3. **Narration**
   ```bash
   python3 scripts/make_tts_chunks.py   # -> narration/tts_chunks.json (50 sentence-aligned chunks)
   ```
   Each chunk is spoken with `generate_audio_batch` (`elevenlabs_v4_turbo`, the
   cloned voice, a `dialogue` with one turn). Download the chunks to
   `work/tts/sNN_pK.mp3` and record them in `work/tts_manifest.json`. Keep the
   batches small (3–4 requests), because larger batches hit the provider's rate
   limit (HTTP 429). Any chunk longer than 15 s gets split at a pause.
   ```bash
   python3 scripts/assemble_audio.py    # -> work/audio/slideNN.wav
   ```
4. **Lip-sync (optional)**: for a chunk, call `generate_video` with `wan2_7`
   at 720p and 3:4, passing `instructor_3x4.jpg` as `start_image` and the
   chunk's TTS job as `audio_references`. Set the duration to the chunk length
   rounded up. Save the clip as `work/pip/slideNN_partK.mp4`. This costs about
   1.5 credits per second. This render lip-syncs only the opening sentence;
   for the rest of the video the instructor window shows the photo with a
   slow "breathing" zoom. Every additional clip you add is picked up
   automatically, and `assemble_audio.py` pads that chunk to the clip's
   length so the mouth stays in sync.
5. **Render**
   ```bash
   python3 scripts/build_video.py              # -> output/GCP_Compute_Engine_AR.mp4
   python3 scripts/build_video.py --preview    # placeholder voice, to check layout and timing
   python3 scripts/build_video.py --only 3     # re-render a single slide segment
   ```

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
