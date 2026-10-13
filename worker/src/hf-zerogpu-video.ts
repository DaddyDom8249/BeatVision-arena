// Explicitly opt-in, free-account-only Wan image-to-video pilot.
// Third-party Space: limited shared ZeroGPU quota, not a production SLA.
const SPACE = "https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space";
const HUB = "https://huggingface.co";
const MAX_SECONDS = 3;
const ALLOWED_IMAGE_HOST = "mdofsinyofqbeapzfygu.supabase.co";
const MODEL = "wan2.2-zerogpu";

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: {"Content-Type": "application/json", "Cache-Control": "no-store"}});
}
function validSource(value: unknown) {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" && u.hostname === ALLOWED_IMAGE_HOST
      && u.pathname.startsWith("/storage/v1/object/sign/visual-assets/")
      && !!u.searchParams.get("token");
  } catch { return false; }
}
function motionScene(body: any) {
  const scenes = body?.payload?.storyboard?.scenes;
  const images = body?.payload?.images?.images;
  if (!Array.isArray(scenes) || scenes.length !== 1 || !Array.isArray(images) || images.length !== 1) {
    throw new Error("ONE_APPROVED_SCENE_AND_IMAGE_REQUIRED");
  }
  const scene = scenes[0];
  const image = images[0];
  if (image.approved !== true || !validSource(image.image_url)) throw new Error("APPROVED_SIGNED_SCENE_IMAGE_REQUIRED");
  const start = Number(scene.startTime ?? scene.start_time);
  const end = Number(scene.endTime ?? scene.end_time);
  const duration = end - start;
  if (!Number.isFinite(duration) || duration < 0.5 || duration > MAX_SECONDS) {
    throw new Error("WAN_ZERO_GPU_SCENE_LIMIT: only 0.5–3-second pilot scenes are allowed; do not claim coverage of longer scenes.");
  }
  const rawPrompt = [scene.visual_direction, scene.visualDirection, scene.movement_direction, scene.movementDirection, scene.camera_direction, scene.cameraDirection].filter(Boolean).join(". ");
  const prompt = ("Cinematic image-to-video. Actual subject movement: walking, turning, gesturing and changing pose. "
    + rawPrompt).slice(0, 1100);
  const number = Number(scene.scene_number || scene.scene || 1);
  return {imageUrl: image.image_url, imageId: String(image.asset_id || image.image_id || image.scene_id || ""), sceneNumber: number, duration, prompt};
}
function parseEvent(text: string) {
  const parts = text.split(/\r?\n\r?\n/);
  for (const part of parts) {
    const event = /^event:\s*(\w+)/m.exec(part)?.[1];
    if (event !== "complete" && event !== "error") continue;
    const raw = /^data:\s*(.+)$/m.exec(part)?.[1] || "";
    if (event === "error") throw new Error("WAN_ZERO_GPU_PROVIDER_ERROR");
    let data: any;
    try { data = JSON.parse(raw); } catch { throw new Error("WAN_ZERO_GPU_BAD_COMPLETION"); }
    const file = Array.isArray(data) ? data[0] : null;
    const url = typeof file === "string" ? file : file?.url;
    let parsed: URL;
    try { parsed = new URL(String(url)); } catch { throw new Error("WAN_ZERO_GPU_VIDEO_URL_MISSING"); }
    if (parsed.protocol !== "https:" || parsed.hostname !== new URL(SPACE).hostname
        || !parsed.pathname.includes("/file=")) throw new Error("WAN_ZERO_GPU_VIDEO_URL_UNTRUSTED");
    return parsed.href;
  }
  throw new Error("WAN_ZERO_GPU_COMPLETION_NOT_CONFIRMED");
}
async function freeIdentity(token: string) {
  const response = await fetch(HUB + "/api/whoami-v2", {
    headers: {Authorization: "Bearer " + token, Accept: "application/json"},
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("WAN_ZERO_GPU_IDENTITY_UNVERIFIED");
  const profile: any = await response.json();
  // Non-PRO Free account only: paid credit extension is unavailable on that tier.
  if (profile?.isPro !== false) throw new Error("WAN_ZERO_GPU_FREE_ACCOUNT_NOT_VERIFIED");
}
export default {
  async fetch(r: Request, e: any) {
    if (!e.GATEWAY_TOKEN || r.headers.get("Authorization") !== "Bearer " + e.GATEWAY_TOKEN) {
      return reply({ok:false,status:"unauthorized"},401);
    }
    if (r.method !== "POST") return reply({ok:false,status:"invalid_method",error:"POST required"},405);
    const token = String(e.HF_VIDEO_TOKEN || "").trim();
    if (!token) return reply({ok:false,status:"provider_unavailable",error:"HF_VIDEO_TOKEN not configured"},503);
    let body: any;
    try { body=await r.json(); } catch { return reply({ok:false,status:"invalid_input"},400); }
    if (body?.contract_version !== "1.1" || body?.operation !== "animate"
        || body?.payload?.generation?.requested_model !== MODEL) {
      return reply({ok:false,status:"contract_mismatch",error:"Explicit wan2.2-zerogpu model selection required."},422);
    }
    let scene: ReturnType<typeof motionScene>;
    try { scene = motionScene(body); } catch(error) {
      return reply({ok:false,status:"invalid_scene",error:String(error instanceof Error?error.message:error)},422);
    }
    try {
      await freeIdentity(token);
    } catch(error) {
      return reply({ok:false,status:"free_quota_not_verified",error:String(error instanceof Error?error.message:error)},503);
    }
    try {
      // Gradio file reference: the signed source is already the single approved image.
      // No provider billing credentials, auto-retry, or paid fallback are used.
      const res = await fetch(SPACE + "/gradio_api/call/generate_video", {
        method:"POST",
        headers: {"Content-Type":"application/json", Authorization:"Bearer "+token},
        body:JSON.stringify({data:[
          {path:scene.imageUrl}, scene.prompt, 4, "still frame, stationary figure, distorted hands, extra limbs, watermark",
          scene.duration, 1, 1, 42, false
        ]}),
        signal: AbortSignal.timeout(25000)
      });
      if (!res.ok) return reply({ok:false,status:"free_provider_unavailable",http_status:res.status},503);
      const submission:any = await res.json();
      const eventId = String(submission?.event_id || "");
      if (!/^[A-Za-z0-9_-]{8,130}$/.test(eventId)) throw new Error("WAN_ZERO_GPU_EVENT_ID_MISSING");
      const statusResponse = await fetch(SPACE + "/gradio_api/call/generate_video/" + encodeURIComponent(eventId), {
        headers: {Authorization:"Bearer "+token, Accept:"text/event-stream"},
        signal:AbortSignal.timeout(165000)
      });
      if (!statusResponse.ok) return reply({ok:false,status:"free_provider_unavailable",http_status:statusResponse.status},503);
      const completion = await statusResponse.text();
      if (completion.length > 1000000) throw new Error("WAN_ZERO_GPU_RESPONSE_TOO_LARGE");
      const video = parseEvent(completion);
      return reply({
        ok:true, contract_version:"1.1", capability:"video", provider:"hf-zerogpu", model:MODEL,
        status:"completed", cost_class:"free", generation_type:"GENERATIVE_VIDEO",
        result:{status:"completed", video_url:video, scene_count:1, generation_type:"GENERATIVE_VIDEO",
          clips:[{scene:scene.sceneNumber,status:"animated",video_url:video,provider:"hf-zerogpu",
            model:MODEL,generation_type:"GENERATIVE_VIDEO",source_image_id:scene.imageId,
            duration_seconds:scene.duration,approval_status:"awaiting_creator_review"}]}
      });
    } catch(error) {
      return reply({ok:false,status:"free_provider_unavailable",
        error:String(error instanceof Error?error.message:error).slice(0,300)},503);
    }
  }
};
