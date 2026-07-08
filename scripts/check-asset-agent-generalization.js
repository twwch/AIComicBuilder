/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const base = path.join(root, "src", request.slice(2));
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (found) return found;
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function compileTypescript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

const { analyzeScriptAssets } = require("../src/lib/asset-agent/analyze-script-assets.ts");
const {
  buildAssetImagePrompt,
  buildCompiledAssetProviderPrompt,
  shouldPreferCompiledDisplayPrompt,
  shouldRebuildAssetDisplayPrompt,
} = require("../src/lib/asset-prompt-builder.ts");

const fixtures = [
  {
    title: "年代军婚样例",
    storyAnalysis: {
      storyMeta: {
        time: "1983年夏天",
        genre: "年代军婚短剧",
        background: "女主夏晴与军官顾远结为夫妻，林雅从旁挑拨。",
        visualStyleBase: "80年代中国现实主义摄影质感",
      },
    },
    script: `
女主：夏晴，年轻军嫂，坚韧清醒。
男主：顾远，军官，克制可靠。
女配：林雅，表面温柔，暗中挑拨。
第一集
场景1：盘山公路 / 清晨 / 外
公路蜿蜒于青山之间，夏晴提着包站在路边。
夏晴：我会把事情说清楚。
顾远：我陪你去。
林雅声音发颤，却避开夏晴的目光。
`,
    expect: {
      roles: [
        ["夏晴", "女主角", "femaleLead"],
        ["顾远", "男主角", "maleLead"],
        ["林雅", "女配角", "femaleSupport"],
      ],
      scenes: ["盘山公路"],
      absentSceneText: ["公路蜿蜒于青"],
      absentCharacterText: ["声音"],
      promptIncludes: ["1983"],
      promptExcludes: ["我会把事情说清楚", "我陪你去"],
    },
  },
  {
    title: "都市职场样例",
    storyAnalysis: {
      storyMeta: {
        time: "现代",
        genre: "都市职场情感剧",
        background: "女主苏晚在公司会议室与投资人秦越交锋。",
      },
    },
    script: `
女主：苏晚，项目负责人。
男主：秦越，投资人。
男配：周承，竞争对手。
场景1：公司会议室 / 日 / 内
苏晚微微弓身，把合同推到秦越面前。
秦越拿起合同，语气平静。
周承冷笑着坐在会议室角落。
保安敬礼：秦总，会议室已经清空。
`,
    expect: {
      roles: [
        ["苏晚", "女主角", "femaleLead"],
        ["秦越", "男主角", "maleLead"],
        ["周承", "男配角", "maleSupport"],
        ["保安", "无名配角", ""],
      ],
      scenes: ["公司会议室"],
      props: ["合同"],
      absentProps: ["弓"],
      promptExcludes: ["秦总，会议室已经清空", "把合同推到秦越面前"],
    },
  },
  {
    title: "古装权谋样例",
    storyAnalysis: {
      storyMeta: {
        time: "架空古代",
        genre: "古装权谋",
        background: "女主云舒与王爷萧景联手查案。",
        visualStyleBase: "古装实拍质感，低饱和宫廷光影",
      },
    },
    script: `
女主：云舒，冷静聪敏。
男主：萧景，王爷，沉稳克制。
反派：沈珏，朝堂权臣。
场景1：王府书房 / 夜 / 内
云舒视角：她看见桌上的玉佩。
云舒握紧玉佩，抬头望向萧景。
沈珏站在书房门口，神情阴沉。
`,
    expect: {
      roles: [
        ["云舒", "女主角", "femaleLead"],
        ["萧景", "男主角", "maleLead"],
        ["沈珏", "反派角色", ""],
      ],
      scenes: ["王府书房"],
      props: ["玉佩"],
      absentCharacterText: ["视角"],
      promptExcludes: ["她看见桌上的玉佩"],
    },
  },
];

function findAsset(project, category, name) {
  return project.assets[category].find((asset) => asset.name === name);
}

function assertNoAssetNameIncludes(project, category, text) {
  const bad = project.assets[category].find((asset) => asset.name.includes(text));
  assert.equal(bad, undefined, `${category} should not include "${text}"`);
}

for (const fixture of fixtures) {
  const project = analyzeScriptAssets({
    title: fixture.title,
    script: fixture.script,
    storyAnalysis: fixture.storyAnalysis,
    style: "真人实拍",
  });

  for (const [name, role, roleKey] of fixture.expect.roles || []) {
    const asset = findAsset(project, "characters", name);
    assert.ok(asset, `${fixture.title}: missing character ${name}`);
    assert.equal(asset.role, role, `${fixture.title}: wrong role for ${name}`);
    if (roleKey !== undefined) assert.equal(asset.roleKey || "", roleKey, `${fixture.title}: wrong roleKey for ${name}`);
  }

  for (const name of fixture.expect.scenes || []) {
    assert.ok(findAsset(project, "scenes", name), `${fixture.title}: missing scene ${name}`);
  }

  for (const name of fixture.expect.props || []) {
    assert.ok(findAsset(project, "props", name), `${fixture.title}: missing prop ${name}`);
  }

  for (const text of fixture.expect.absentSceneText || []) {
    assertNoAssetNameIncludes(project, "scenes", text);
  }

  for (const text of fixture.expect.absentCharacterText || []) {
    assertNoAssetNameIncludes(project, "characters", text);
  }

  for (const text of fixture.expect.absentProps || []) {
    assertNoAssetNameIncludes(project, "props", text);
  }

  const promptSource = [
    ...project.assets.characters,
    ...project.assets.props,
    ...project.assets.scenes,
  ].map((asset) => asset.prompt).join("\n");
  for (const text of fixture.expect.promptIncludes || []) {
    assert.match(promptSource, new RegExp(text), `${fixture.title}: prompt should include ${text}`);
  }

  for (const text of fixture.expect.promptExcludes || []) {
    assert.equal(promptSource.includes(text), false, `${fixture.title}: prompt should not include dialogue/action text "${text}"`);
  }

  console.log(`PASS ${fixture.title}`);
}

const displayPrompt = "【整体美学】\n1990年代中国现实主义摄影质感。\n\n【角色档案】\n测试女主是剧本中的女主角，性别识别为女性。\n\n【服装发型】\n上衣：红色棉袄。发型：短发。\n\n【排除项】\n无文字，无现代豪车。";
const compiled = buildAssetImagePrompt({
  asset: {
    id: "test_character",
    type: "character",
    name: "测试女主",
    role: "女主角",
    category: "characters",
    prompt: displayPrompt,
    description: "测试女主是剧本中的女主角。",
    visualConstraints: "性别识别保持女性，1990年代中国，红色棉袄，短发。",
    negativeConstraints: "无文字，无现代豪车。",
    tags: ["女主角", "女性"],
  },
  styleSpec: {
    era: "1990s China",
    eraConstraint: "1990s China",
    genre: "realistic Chinese short-drama asset reference",
  },
});
assert.match(compiled.compiled_final_prompt, /Asset reference sheet/i);
assert.match(compiled.compiled_final_prompt, /1990s China/i);
assert.match(compiled.compiled_final_prompt, /red cotton-padded jacket/i);
assert.match(compiled.compiled_final_prompt, /short hair/i);
assert.doesNotMatch(compiled.compiled_final_prompt, /【整体美学】|【角色档案】|上衣：|发型：/);
assert.match(compiled.compiled_display_prompt, /测试女主的资产参考图/);
assert.match(compiled.compiled_display_prompt, /外观：/);
assert.match(compiled.compiled_display_prompt, /服装：/);
assert.match(compiled.compiled_display_prompt, /排版布局：/);
assert.match(compiled.compiled_display_prompt, /风格：/);
assert.match(compiled.compiled_display_prompt, /必需的视觉约束：/);
assert.doesNotMatch(compiled.compiled_display_prompt, /排除项：/);
assert.match(compiled.compiled_display_prompt, /1990年代中国/);
assert.match(compiled.compiled_display_prompt, /红色棉袄/);
assert.match(compiled.compiled_display_prompt, /短发/);
assert.doesNotMatch(compiled.compiled_display_prompt, /【角色档案】|陆少|剧本中的|剧情档案/);

const providerPrompt = buildCompiledAssetProviderPrompt({
  sourcePrompt: displayPrompt,
  compiledPrompt: compiled.compiled_final_prompt,
  category: "characters",
  targetName: "测试女主",
  mode: "main",
});
assert.match(providerPrompt, /STRUCTURED ENGLISH IMAGE PROMPT/i);
assert.match(providerPrompt, /COMPILED VISUAL PROMPT/i);
assert.doesNotMatch(providerPrompt, /AUTHORITATIVE USER IMAGE PROMPT|The following Chinese image prompt/i);

const pollutedDisplayPrompt = "【角色档案】\n测试女主是剧本中的女主角。陆少，听说你缺个端茶倒水的。巧了，我刚好不想努力了。这婚，我结。你回来怎么不出声？你能感觉到我吃的味道？没事。";
assert.equal(shouldRebuildAssetDisplayPrompt(pollutedDisplayPrompt), true, "dialogue-polluted display prompt should be rebuilt");
const partialConstraintPrompt = "女主角真人模板；主图与全部变体必须严格保持模板的脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致；只允许改变发型、服装、妆造强弱和剧情状态，禁止漫画风、二次元和插画感。";
assert.equal(shouldRebuildAssetDisplayPrompt(partialConstraintPrompt), true, "constraint-only display prompt should be rebuilt");
assert.equal(shouldRebuildAssetDisplayPrompt(displayPrompt), true, "legacy section display prompt should be rebuilt");
assert.equal(shouldRebuildAssetDisplayPrompt(compiled.compiled_display_prompt), false, "compiled Chinese asset display prompt should be preserved");

const genericEraDisplayPrompt = [
  "中国女性，女主角",
  "测试女主的资产参考图，现实主义中国短剧资产参考，现实主义现代/平民中国，除非资产结构明确指定其他时代。",
  "外观：真人实拍摄影，自然皮肤纹理，准确全身比例。",
].join("\n");
const preciseEraCompiled = buildAssetImagePrompt({
  asset: {
    id: "test_precise_year",
    type: "character",
    name: "测试女主",
    role: "女主角",
    category: "characters",
    prompt: genericEraDisplayPrompt,
    description: "测试女主是剧本中的女主角。",
    visualConstraints: "1980年代中国日常服装，但故事明确发生在1983年夏天。",
    tags: ["女主角", "女性"],
  },
  styleSpec: {
    era: "1983 China",
    eraConstraint: "1983 China",
    genre: "realistic Chinese short-drama asset reference",
  },
});
assert.match(preciseEraCompiled.compiled_final_prompt, /1983 China/);
assert.match(preciseEraCompiled.compiled_display_prompt, /1983年中国/);
assert.equal(
  shouldPreferCompiledDisplayPrompt(genericEraDisplayPrompt, preciseEraCompiled.compiled_display_prompt),
  true,
  "generic-era Chinese display prompt should be replaced by precise compiled era prompt",
);
assert.equal(
  shouldPreferCompiledDisplayPrompt(preciseEraCompiled.compiled_display_prompt, preciseEraCompiled.compiled_display_prompt),
  false,
  "precise compiled Chinese display prompt should stay editable and be preserved",
);

console.log("Asset agent generalization checks passed.");
