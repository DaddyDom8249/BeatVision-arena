# BeatVision Character Performance & Motion Director Specification

## Purpose
BeatVision is not a static-image music visualizer. Its long-term creative target is a music-to-cinema system that can direct believable character performance and cinematic motion while preserving the identity and visual world established for the song.

Core promise:
**Every Song Has a World. BeatVision Reveals It.**

## Canonical pipeline
SONG → GEMINI UNDERSTANDS → WORLD → CHARACTER BIBLE → ENVIRONMENT BIBLE → STORY → STORYBOARD → APPROVED SCENE IMAGE → CHARACTER PERFORMANCE → CAMERA MOVEMENT → ENVIRONMENT MOTION → AUDIO/LIP SYNC → TIMELINE → CINEMATIC MUSIC VIDEO

## Creative intelligence ownership
BeatVision owns the creative intent and continuity. AI/video providers are replaceable execution engines.

Gemini/creative intelligence must understand and carry forward:
- song identity, lyrics, mood, themes, emotional arc, musical sections and timing
- World Report and approved visual language
- Character Bible and identity locks
- Environment Bible and environment locks
- recurring props/motifs
- scene purpose and relationship to adjacent scenes
- performance direction
- camera direction and kinetics
- motion timing
- audio/lip-sync requirements when applicable

The motion provider must execute this direction rather than invent a new character, world, story, or visual language.

## Character performance requirements
When motion generation is available, BeatVision should be capable of directing realistic or intentionally stylized:
- walking, running, dancing, singing and other full-body actions
- gestures, posture, weight shifts and natural body mechanics
- facial expressions and emotional reactions
- eye direction, head movement and subtle micro-performance
- interaction with other characters and objects
- environmental interaction
- wardrobe/hair movement consistent with the action
- camera movement that is intentional and scene-specific
- lip synchronization to supplied dialogue/vocal/audio when supported

The exact capability depends on the selected motion provider. Never fake unsupported capability.

## Continuity rules
Character identity must persist across scenes unless the user intentionally changes it:
- face and recognizable identity
- age/physical traits
- hair
- body proportions/silhouette
- wardrobe and accessories
- personality/emotional identity
- approved reference assets

Environment continuity must persist unless intentionally changed:
- location/architecture
- time and weather
- lighting
- palette
- atmosphere
- recurring objects

Motion continuity must also respect:
- previous/next scene context
- pose and action continuity where relevant
- emotional progression
- camera language
- song timing and scene duration

## First-frame gate
Do not spend video-generation resources on a scene whose approved first frame/reference is wrong.

The intended production sequence is:
1. generate or select scene concept/reference
2. review/approve the visual identity and composition
3. generate motion from the approved visual anchor
4. review the resulting performance
5. regenerate only the failed shot, not the whole project

## Motion-plan contract
Every animatable scene should have, where applicable:
- Character Motion
- Facial Performance
- Interaction
- Environment Motion
- Camera Motion/Kinetics
- Timing
- Audio/Lip Sync requirements
- continuity constraints

A vague instruction such as "make her dance" is insufficient. Motion direction should describe what changes over time, including subject movement, expression, environment response, camera behavior and timing.

## User authority
The user is the creative director.
AI proposes and executes. It must not silently overwrite approved creative decisions.

Approved world, characters, environments, scene decisions and references are authoritative inputs for later generation.

## Provider abstraction
Keep motion generation behind a provider-agnostic interface. Candidate providers may change over time.

Conceptual interface:
- generateWorld()
- refineWorld()
- generateStoryboard()
- generateSceneConcept()
- generateMotionPlan()
- generateVideo()

A future motion provider may accept an approved scene image/reference plus the BeatVision motion plan and return a real video asset.

Do not hard-code BeatVision to a single vendor.

## Honest capability states
Never label a still image as video.
Never claim motion, lip sync, animation, rendering, upload, or generation succeeded unless a real provider response and real returned asset have been verified.

Track these separately:
1. code passes
2. endpoint works
3. provider works
4. real asset returned
5. asset loads/displays
6. actual motion/performance quality is verified

## Architecture rule
Do not reintroduce unnecessary infrastructure merely to support motion. Use the smallest secure provider path that can execute the approved BeatVision direction. Permanent provider credentials remain server-side.

Do not add Cloudflare Workers, Supabase, Firebase, queues, render farms, microservices, multiple repositories, payments, or other infrastructure unless the required capability genuinely needs it.

## V1/V2 boundary
The creative model should be designed for realistic character performance now, but implementation may remain staged:
- static scene concept/reference first
- real scene image generation next
- single-scene character motion proof next
- audio/lip sync where supported
- multi-scene continuity and timeline assembly after single-scene motion is proven

Do not pretend long-form photorealistic video generation exists before it has been integrated and verified.

## Canonical proof scene
Use an existing BeatVision scene such as Fast Car — Scene 1, "Blue Hour Shift", for motion-provider validation when practical.

Example direction:
The narrator exits the service station, pauses beside the pickup, looks toward the highway with restrained uncertainty, then walks toward the vehicle. The camera tracks laterally. Fluorescent station light gives way to blue-hour ambient light. Preserve the approved face, hair, clothing, body identity and emotional state.

The goal is not merely to animate pixels. The goal is to make the approved BeatVision character visibly perform the approved scene.

## Non-negotiable
BeatVision must evolve toward:
**song understanding → visual world → consistent characters → directed scenes → believable character performance → cinematic camera/environment motion → synchronized timeline → finished music video.**

This specification is canonical creative architecture and must be preserved across BeatVision projects. Implementation details may vary by repository, but this creative logic must not drift.
