# 08 · Making full videos inside Claude Code (and Codex)

**Researched and partly verified 9 Nov 2026.**

## The honest picture

Claude Code and Codex don't draw pixels themselves. They **orchestrate**: they write the script,
call image, video and voice models through plugins, MCP servers or APIs, then **assemble the
final video in code** (Remotion or ffmpeg). Done that way, a whole episode can be made from the
terminal.

**Verified in this repo, in this session:**
- ✅ **Character images:** the Figma MCP `generate_image` tool (gpt-image-2.5) made every sheet in `characters/`.
- ✅ **Assembly and render:** the Remotion template in [`marketing/video-studio/`](../../../marketing/video-studio/)
  rendered [`characters/demo-elo-wall-sit.mp4`](characters/demo-elo-wall-sit.mp4) in about 1 minute,
  using the pre-installed headless Chrome and ffmpeg.
- ⛔ **Not verified here:** paid video and voice generation (fal, ElevenLabs, Creative Claw), because
  they need your accounts and API keys. Their install steps below come from vendor docs and
  community listings; check each one before relying on it.

---

## 1. Two production routes

| | **Route A: AI-generated (recommended)** | **Route B: code-native 3D** |
|---|---|---|
| How | Golden character sheet → still per shot (image model) → short motion clips (image-to-video) → narrator voiceover → **Remotion** assembles captions, overlays and the end card | A rigged 3D Elo in Blender or three.js, animated by code, rendered frame by frame |
| Look | Swolo-level polish | Fully deterministic and perfectly on-model, but needs a 3D artist's model first |
| Cost per video | About $5–25 in generation | About $0 per video once the model is built |
| Use now? | **Yes** | Later, once Elo is proven and you want unlimited, cheap episodes |

---

## 2. What to install for Claude Code

| Job | Use | How to get it | Status |
|---|---|---|---|
| **Assembly, captions, overlays** | **Remotion** | Anthropic Directory plugin **"Remotion"** (12 skills: create, captions, render, studio…), or `npx skills add remotion-dev/skills`. The template is already in `marketing/video-studio/` | ✅ Works here |
| **Character images** (from the golden sheets) | Figma MCP `generate_image` | Already connected to your account | ✅ Used for the sheets |
| | **Creative Claw** plugin (Nano Banana, Seedance, Gemini Omni, ElevenLabs, "consistent characters", multi-shot films) | Anthropic Directory → add plugin → sign in on its Connectors tab | Available, not installed |
| | **fal MCP** (Nano Banana Pro, Flux) | `claude mcp add fal-ai -e FAL_KEY=… -- npx -y <fal MCP package>`. Package names differ between listings (`fal-ai-mcp`, `fal-ai-mcp-server`), so check fal's docs | Needs a fal key |
| | **Weave** via Figma (Nano Banana 2, Veo 3) | Link Figma to Weave at app.weavy.ai → Settings → Profile | ⚠️ Not linked yet |
| **Image-to-video** (the moving shots) | **fal MCP**: Kling 3.0, Seedance 2.5, Veo 3.1 | Same fal key | Needs a key |
| | **Creative Claw** (Seedance, Gemini Omni) | Plugin plus sign-in | Available |
| | **Higgsfield** | Its MCP is already connected (browse models and past generations), but by its own description it **can't generate**. Use its CLI or skills for coding agents instead | Partial |
| **Narrator voice + word timestamps** | **ElevenLabs** official plugin (skill plus hosted MCP, OAuth) | github.com/elevenlabs/plugin. Use the text-to-speech-with-timestamps endpoint so the captions sync to the voice | Needs an account |
| **Music and SFX** | ElevenLabs sound effects · Creative Claw (Mureka music) | — | — |
| **Code-native motion** (Route B, or animated overlays) | **Motion Reel** plugin (three.js 3D + 2D canvas, synthesized score, contact-sheet critique loop, lip-sync) · **animation-studio** plugin (code-drawn 2D shorts with a synthesized soundtrack, 9:16) | Anthropic Directory | Available |
| **3D (Route B)** | **Blender MCP** (`ahujasid/mcp-for-blender`): `claude mcp add blender -- uvx mcp-for-blender`, plus the Blender add-on | Community project | Needs Blender locally |
| **Prompt quality** | **image-generation** plugin (a model-agnostic prompting guide) | Anthropic Directory | Available |
| **Already in this environment** | `social-media-skills` (reels-script, kling, veo-3, runway, heygen, nano-banana, ai-voiceover, capcut, captions…), ffmpeg, headless Chromium, yt-dlp | — | ✅ |

**Smallest useful setup:** the Remotion plugin, plus **one** generation provider (fal, *or* Creative
Claw), plus **ElevenLabs**. That's three things.

> **Cloud sessions:** generation APIs need network access. When a key is needed, Claude asks for it
> with a secure credential card (it never goes in chat). Saving the key also allows that host
> (for example `fal.run`, `queue.fal.run`, `api.elevenlabs.io`).

---

## 3. The same thing in Codex

Codex reads the same **Agent Skills** format and **MCP servers** (configured through `codex mcp add`
or `~/.codex/config.toml`), so the stack carries over:

| Job | Codex |
|---|---|
| Remotion | `npx skills add remotion-dev/skills`. Remotion's docs list Codex as supported. Then run `codex` inside `marketing/video-studio/` |
| fal (images and video) | `codex mcp add fal -- <fal MCP command>` with `FAL_KEY` in the environment |
| ElevenLabs | The official plugin ships a Codex skill plus a hosted MCP |
| Blender | `codex mcp add blender -- uvx mcp-for-blender` |
| Higgsfield | The Higgsfield CLI and its agent skills |
| This repo's template | Works as-is: it's just Node and Remotion |

Figma's MCP server also supports other MCP clients, so you can keep generating sheets from Codex.

---

## 4. One episode, end to end (Route A)

```
1. SCRIPT     Pick a row from 04-30-video-plan.md → write src/episodes/<move>.json
              (5–7 beats, one caption per beat, highlight words, day ranges, level, source lines)
2. VOICE      ElevenLabs "Elovia Coach" voice ID → narration MP3 + word timestamps
              → public/vo/<move>.mp3 (set "voiceover" in the JSON)
3. STILLS     For each beat: paste the ELO/ELA block + [LEVEL] + world block from 02-avatar-bible.md,
              add the pose/scene. Always pass the golden sheet as the reference image.
              → public/<move>/beat-N.jpg
4. MOTION     Image-to-video (Kling 3.0 / Seedance 2.5) for the 1–2 beats where the move happens
              (5–8s each, one action, no camera chaos) → public/<move>/beat-N.mp4 ("video")
5. ANATOMY    Re-generate the key pose with the anatomy-overlay add-on (orange muscles)
6. RENDER     npx remotion render src/index.ts ThirtyDay out/<move>.mp4 --props=…
7. QA         Contact sheet of frames → check on-model, caption safe zones, numbers, disclosure tag
8. DUB        Swap in the Hinglish voiceover and caption text → render the _IN version
```

### A prompt you can give Claude Code or Codex for each episode

```
Make episode D07 from docs/marketing/avatar-content-system/04-30-video-plan.md.
Follow 02-avatar-bible.md exactly (ELA block, Level 1→2 only, world block, negative list).
1) Write marketing/video-studio/src/episodes/d07.json.
2) Generate the voiceover with the Elovia Coach voice and save word timestamps.
3) Generate stills for every beat using characters/ela-female-sheet.jpg as the reference;
   generate one image-to-video clip for the exercise beat.
4) Render out/d07.mp4 and an _IN Hinglish version; make a contact sheet and check it against
   the style-guide QA list before you tell me it's done.
```

---

## 5. Sources

Remotion's [Agent Skills docs](https://www.remotion.dev/docs/ai/skills) and
[coding-agents guide](https://www.remotion.dev/docs/ai/coding-agents) ·
[ElevenLabs plugin for coding agents](https://github.com/elevenlabs/plugin) ·
[Blender MCP](https://github.com/ahujasid/mcp-for-blender) ·
[Blender MCP setup for Codex and Claude Code](https://www.strayspark.studio/blog/blender-mcp-setup-codex-cursor-gemini-vscode-2026) ·
[Higgsfield on AI video MCP servers](https://higgsfield.ai/blog/best-ai-video-mcp-servers) ·
[Composio: ElevenLabs with Codex](https://composio.dev/toolkits/elevenlabs/framework/codex) ·
[fal MCP listing (Glama)](https://glama.ai/mcp/servers/Szotasz/fal-ai-mcp-server) ·
Plugins found in the Anthropic Directory (9 Nov 2026): Remotion, Motion Reel, animation-studio,
Creative Claw, CellCog, image-generation.
