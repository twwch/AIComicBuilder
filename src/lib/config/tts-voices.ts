/** Character → TTS voice mapping.
 *  Exact match first, then fuzzy (key contained in character name), then defaultVoice fallback.
 *  Override via TTS_VOICE_MAP env var (JSON object). */
export const TTS_VOICE_MAP: Record<string, string> = {
  "蚁后": "zh-CN-XiaoxiaoNeural",
  "侦察兵小六": "zh-CN-YunxiNeural",
  "小蚂蚁豆豆": "zh-CN-XiaomengNeural",
  "大力蚁阿壮": "zh-CN-YunjianNeural",
  "蚂蚁甲": "zh-CN-YunxiNeural",
  "蚂蚁乙": "zh-CN-YunyangNeural",
  "男": "zh-CN-YunxiNeural",
  "女": "zh-CN-XiaoxiaoNeural",
  "老人": "zh-CN-YunjianNeural",
  "小孩": "zh-CN-XiaomengNeural",
};

export const DEFAULT_TTS_VOICE = "zh-CN-XiaoxiaoNeural";
