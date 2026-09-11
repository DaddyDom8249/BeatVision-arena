window.BeatVisionContracts = {
  version: "1.1",
  operations: {
    analyzeAudio: { capability: "audio", path: "/v1/audio/analyze" },
    revealWorld: { capability: "language", path: "/v1/language/world" },
    worldAssets: { capability: "image", path: "/v1/image/world-assets" },
    storyboard: { capability: "language", path: "/v1/language/storyboard" },
    sceneImages: { capability: "image", path: "/v1/image/scenes" },
    animate: { capability: "video", path: "/v1/video/animate" },
    assemble: { capability: "video", path: "/v1/video/assemble" },
    generateMusic: { capability: "music", path: "/v1/audio/generate" },
    storeAsset: { capability: "storage", path: "/v1/storage/asset" }
  },
  capabilities: ["language", "image", "video", "audio", "music", "storage"],
  stages: [
    ["analyze", "Audio analysis", "audio"],
    ["world", "Reveal the World", "language"],
    ["assets", "World Assets", "image"],
    ["storyboard", "Storyboard", "language"],
    ["images", "Scene Images", "image"],
    ["motion", "Motion", "video"],
    ["assemble", "Music Video Assembly", "video"],
    ["export", "Export / Delivery", "storage"]
  ]
};
