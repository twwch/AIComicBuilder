import { PromptDefinition, slot } from "./registry-helpers";

const STRIKE_PREPARATION = `弓步出拳蓄力：wide shot of martial artist in fighting stance, left leg forward, right arm cocked back, tension visible in shoulder muscles, dramatic side lighting, anticipation moment before strike
飞踢起跳准备：medium shot of character jumping upward, both arms raised for spinning kick, right leg extended, motion blur on trailing leg, dynamic pose in mid-air
双掌推出前奏：close-up of character with both palms thrust forward, chi energy gathering around hands, glowing aura, intense concentration on face, wind blowing robe flutters backward
蹲伏防御准备：low angle shot of character in defensive crouch, both fists raised in guard position, eyes focused on opponent, weight shifted to back foot, tension in muscles
武器举起的瞬间：medium shot of character raising sword overhead, blade catching light, muscles tensed in both arms, dramatic silhouette against bright sky background`;

const IMPACT_MOMENTS = `拳头命中脸部：close-up of fist impact on face, skin distortion, blood splatter radiating from contact point, motion blur on punch trajectory, slow motion effect, visceral realism
踢腿命中躯干：medium shot of side kick landing on opponent's ribcage, foot driving forward, opponent's body bending from impact, dust cloud at contact point, powerful and decisive
肘击砸下：top-down close-up of elbow descending toward ground, target area showing deformation from force, surrounding debris scattering outward, shadow of arm creating dramatic framing
掌推胸口爆发：medium shot of palm strike to chest, victim being lifted off ground from impact, clothes billowing from force, energy wave visible in surrounding air, dynamic power transfer
指法点击穴道：extreme close-up of fingertip touching pressure point on neck, subtle nerve activation visible, minimal but precise movement, clinical accuracy, tension in single point of contact
膝击上扬命中：close-up from below of knee driving upward, impact point under chin, head snapped back from force, split second capture of violence`;

const MOVEMENT_REPOSITIONING = `侧闪后移：side view of character dodging sideways, body leaning back at sharp angle, attack passing through previous position, controlled retreat motion, floor dust kicked up
翻滚绕后：aerial top view of character performing forward roll, legs tucking tight, emerging on opposite side, momentum preserved through the movement, fluid and athletic
跳步逼近：medium shot of character advancing with hopping steps, weight forward, fists protecting face, aggressive forward pressure, intimidating approach
后撤拉距：wide shot of character stepping backward creating distance, arms extended maintaining reach, calculating distance for counterattack, defensive positioning
侧踏横移：low angle tracking shot of character moving laterally, both feet performing side steps, staying facing forward, circle walking around opponent, tactical positioning
跃起空翻：slow motion shot of character performing backflip, body rotating backward in complete circle, legs extended at apex, landing in ready stance, aerial dominance display`;

const INJURY_DEPICTION = `淤青浮现：close-up of cheek showing bruise forming, skin discoloration spreading in real time, tender swelling beginning, pain slightly visible in expression, subtle damage accumulation
血迹流淌：extreme close-up of blood streaming from cut on forehead, single stream running down face, gravity affecting trajectory, red against pale skin, raw and visceral
骨折变形：close-up of limb showing abnormal angle after break, bone possibly visible through skin, immediate swelling, visceral shock in subject's eyes, graphic injury detail
牙血渗出：close-up of character with blood trickling from corner of mouth, evidence of internal damage from blunt trauma, grimace of pain, mixed with defiance, fighting spirit despite injury
伤口撕裂：medium close-up of slash wound on arm, edges separated by deep cut, subcutaneous tissue visible, blood pooling in wound bed, pain and determination simultaneously expressed
眼周红肿：close-up of swollen eye bruising in real time, orbital area turning purple, eyelid drooping from swelling, vision impairment visible, cumulative damage showing`;

const WEAPON_COMBAT = `剑劈斜斩：medium shot of sword cutting diagonally downward through frame, blade angle at 45 degrees, target splitting in half along cut line, metallic glint on blade edge, decisive slash
刀横斩：wide shot of horizontal sword slash cutting across screen, blade parallel to ground, force of swing creating air distortion wave, target at center, pure cutting power
棍扫一片：wide shot of staff sweeping through group, wooden weapon passing through multiple targets, all falling in sequence from single strike, overwhelming force demonstration
双剑格挡：close-up of two blades crossed in guard position, sparks flying from friction point, tension in both characters' arms, steel grinding against steel, clash of equal opponents
飞刀出手：POV shot from thrower's perspective, blade spinning toward target, lethal trajectory through air, motion blur on rapidly rotating knife, precision and lethality combined
长枪刺击：medium shot of spear thrusting forward, tip aimed at opponent's chest, both hands extending weapon, tip leading motion, simple direct penetrating attack, focused and deadly`;

export const battleChoreographyDef: PromptDefinition = {
  key: "battle_choreography",
  nameKey: "promptTemplates.prompts.battleChoreography",
  descriptionKey: "promptTemplates.prompts.battleChoreographyDesc",
  category: "shot",
  slots: [
    slot("strike_preparation", STRIKE_PREPARATION, true),
    slot("impact_moments", IMPACT_MOMENTS, true),
    slot("movement_repositioning", MOVEMENT_REPOSITIONING, true),
    slot("injury_depiction", INJURY_DEPICTION, true),
    slot("weapon_combat", WEAPON_COMBAT, true),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => sc[k] ?? s.find((sl) => sl.key === k)?.defaultContent ?? "";
    return [
      "# 武打分镜提示词模板库 (Fight Scene Prompt Templates)",
      "",
      "当检测到战斗/对决场景时，从以下分类中选用合适的提示词模板生成关键帧 / 参考图图像：",
      "",
      "---",
      "## 出招蓄力类 (Strike Preparation)",
      r("strike_preparation"),
      "",
      "---",
      "## 打击瞬间类 (Impact Moments)",
      r("impact_moments"),
      "",
      "---",
      "## 位移换位类 (Movement & Repositioning)",
      r("movement_repositioning"),
      "",
      "---",
      "## 伤势表现类 (Injury Depiction)",
      r("injury_depiction"),
      "",
      "---",
      "## 武器武打类 (Weapon Combat)",
      r("weapon_combat"),
    ].join("\n");
  },
};
