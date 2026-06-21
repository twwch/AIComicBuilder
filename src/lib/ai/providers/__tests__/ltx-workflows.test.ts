import { describe, it, expect } from "vitest";
import { getSigmaSchedules, getCameraLoRAName, buildLTXi2vT2vWorkflow, buildLTXFlf2vWorkflow } from "../ltx-workflows";

describe("getSigmaSchedules", () => {
  it("returns balanced preset by default", () => {
    const result = getSigmaSchedules();
    expect(result.main).toContain("1.0");
    expect(result.refiner).toContain("0.85");
  });

  it("returns speed preset", () => {
    const result = getSigmaSchedules("speed");
    expect(result.main).toBe("1.0, 0.725, 0.421875, 0.0");
    expect(result.refiner).toBe("0.85, 0.4219, 0.0");
  });

  it("returns balanced preset", () => {
    const result = getSigmaSchedules("balanced");
    expect(result.main.split(",")).toHaveLength(9);
    expect(result.refiner.split(",")).toHaveLength(4);
  });

  it("returns quality preset", () => {
    const result = getSigmaSchedules("quality");
    expect(result.main.split(",")).toHaveLength(17);
    expect(result.refiner.split(",")).toHaveLength(6);
  });

  it("returns quality_lite preset", () => {
    const result = getSigmaSchedules("quality_lite");
    expect(result.main.split(",")).toHaveLength(13);
    expect(result.refiner.split(",")).toHaveLength(5);
  });
});

describe("getCameraLoRAName", () => {
  it("returns undefined when no control given", () => {
    expect(getCameraLoRAName()).toBeUndefined();
    expect(getCameraLoRAName(undefined)).toBeUndefined();
  });

  it("returns correct LoRA name for dolly-in", () => {
    expect(getCameraLoRAName("dolly-in")).toContain("dolly-in");
  });

  it("returns correct LoRA name for pan-left", () => {
    expect(getCameraLoRAName("pan-left")).toContain("pan-left");
  });

  it("returns correct LoRA name for zoom-in", () => {
    expect(getCameraLoRAName("zoom-in")).toContain("zoom-in");
  });

  it("returns correct LoRA name for orbit-cw", () => {
    expect(getCameraLoRAName("orbit-cw")).toContain("orbit-cw");
  });

  it("returns correct LoRA name for static", () => {
    expect(getCameraLoRAName("static")).toContain("static");
  });

  it("returns correct LoRA name for tilt-up", () => {
    expect(getCameraLoRAName("tilt-up")).toContain("tilt-up");
  });

  it("returns undefined for unknown control", () => {
    expect(getCameraLoRAName("unknown" as never)).toBeUndefined();
  });
});

describe("buildLTXi2vT2vWorkflow", () => {
  const prompt = "A cat walking";
  const duration = 8;
  const fps = 24;
  const prefix = "test_output";

  it("returns a workflow object for i2v mode", () => {
    const wf = buildLTXi2vT2vWorkflow(prompt, duration, fps, prefix, "input.png");
    expect(typeof wf).toBe("object");
    expect(wf["75"]).toBeDefined();
    expect((wf["75"] as any).class_type).toBe("SaveVideo");
    expect((wf["75"] as any).inputs.filename_prefix).toBe(prefix);
  });

  it("includes LoadImage node in i2v mode", () => {
    const wf = buildLTXi2vT2vWorkflow(prompt, duration, fps, prefix, "input.png");
    expect(wf["269"]).toBeDefined();
    expect((wf["269"] as any).class_type).toBe("LoadImage");
    expect((wf["269"] as any).inputs.image).toBe("input.png");
  });

  it("includes EmptyImage node in t2v mode", () => {
    const wf = buildLTXi2vT2vWorkflow(prompt, duration, fps, prefix, undefined);
    expect(wf["320:325"]).toBeDefined();
    expect((wf["320:325"] as any).class_type).toBe("EmptyImage");
  });

  it("sets bypass on LTXVImgToVideoInplace in t2v mode", () => {
    const wf = buildLTXi2vT2vWorkflow(prompt, duration, fps, prefix, undefined);
    expect((wf["320:288"] as any).inputs.bypass).toBe(true);
  });

  it("does not bypass LTXVImgToVideoInplace in i2v mode", () => {
    const wf = buildLTXi2vT2vWorkflow(prompt, duration, fps, prefix, "input.png");
    expect((wf["320:288"] as any).inputs.bypass).toBe(false);
  });

  it("includes prompt text", () => {
    const wf = buildLTXi2vT2vWorkflow(prompt, duration, fps, prefix, "input.png");
    expect((wf["320:319"] as any).inputs.value).toBe(prompt);
  });

  it("uses 16:9 dimensions by default", () => {
    const wf = buildLTXi2vT2vWorkflow(prompt, duration, fps, prefix, "input.png");
    expect((wf["320:312"] as any).inputs.value).toBe(1280);
    expect((wf["320:299"] as any).inputs.value).toBe(720);
  });

  it("uses portrait dimensions for 9:16 ratio", () => {
    const wf = buildLTXi2vT2vWorkflow(prompt, duration, fps, prefix, "input.png", "9:16");
    expect((wf["320:312"] as any).inputs.value).toBe(720);
    expect((wf["320:299"] as any).inputs.value).toBe(1280);
  });

  it("includes duration and fps", () => {
    const wf = buildLTXi2vT2vWorkflow(prompt, duration, fps, prefix, "input.png");
    expect((wf["320:301"] as any).inputs.value).toBe(duration);
    expect((wf["320:300"] as any).inputs.value).toBe(fps);
  });

  it("includes sigma preset when provided", () => {
    const wf = buildLTXi2vT2vWorkflow(prompt, duration, fps, prefix, "input.png", undefined, "quality");
    expect((wf["320:281"] as any).inputs.sigmas).toBe(getSigmaSchedules("quality").refiner);
    expect((wf["320:306"] as any).inputs.sigmas).toBe(getSigmaSchedules("quality").main);
  });

  it("inserts camera LoRA node when camera control is provided", () => {
    const wf = buildLTXi2vT2vWorkflow(prompt, duration, fps, prefix, "input.png", undefined, undefined, "pan-left");
    expect(wf["320:333"]).toBeDefined();
    expect((wf["320:333"] as any).class_type).toBe("LoraLoaderModelOnly");
    expect((wf["320:333"] as any).inputs.lora_name).toContain("pan-left");
  });

  it("does not insert camera LoRA node when no camera control", () => {
    const wf = buildLTXi2vT2vWorkflow(prompt, duration, fps, prefix, "input.png");
    expect(wf["320:333"]).toBeUndefined();
  });

  it("includes negative prompt CLIP encoding", () => {
    const wf = buildLTXi2vT2vWorkflow(prompt, duration, fps, prefix, "input.png");
    expect((wf["320:313"] as any).class_type).toBe("CLIPTextEncode");
    expect((wf["320:313"] as any).inputs.text).toBeTruthy();
  });
});

describe("buildLTXFlf2vWorkflow", () => {
  const prompt = "A cat walking";
  const firstFrame = "frame1.png";
  const lastFrame = "frame2.png";
  const duration = 8;
  const fps = 24;
  const prefix = "test_output";

  it("returns a workflow object", () => {
    const wf = buildLTXFlf2vWorkflow(prompt, firstFrame, lastFrame, duration, fps, prefix);
    expect(typeof wf).toBe("object");
    expect(wf["68"]).toBeDefined();
    expect((wf["68"] as any).class_type).toBe("SaveVideo");
    expect((wf["68"] as any).inputs.filename_prefix).toBe(prefix);
  });

  it("includes LoadImage for first frame", () => {
    const wf = buildLTXFlf2vWorkflow(prompt, firstFrame, lastFrame, duration, fps, prefix);
    expect((wf["31"] as any).class_type).toBe("LoadImage");
    expect((wf["31"] as any).inputs.image).toBe(firstFrame);
  });

  it("includes LoadImage for last frame", () => {
    const wf = buildLTXFlf2vWorkflow(prompt, firstFrame, lastFrame, duration, fps, prefix);
    expect((wf["39"] as any).class_type).toBe("LoadImage");
    expect((wf["39"] as any).inputs.image).toBe(lastFrame);
  });

  it("includes prompt text", () => {
    const wf = buildLTXFlf2vWorkflow(prompt, firstFrame, lastFrame, duration, fps, prefix);
    expect((wf["129:128"] as any).inputs.text).toBe(prompt);
  });

  it("includes duration and fps", () => {
    const wf = buildLTXFlf2vWorkflow(prompt, firstFrame, lastFrame, duration, fps, prefix);
    expect((wf["129:102"] as any).inputs.value).toBe(duration);
    expect((wf["129:114"] as any).inputs.value).toBe(fps);
  });

  it("inserts camera LoRA node when camera control is provided", () => {
    const wf = buildLTXFlf2vWorkflow(prompt, firstFrame, lastFrame, duration, fps, prefix, undefined, "dolly-in");
    expect(wf["129:131"]).toBeDefined();
    expect((wf["129:131"] as any).class_type).toBe("LoraLoaderModelOnly");
  });

  it("uses 720x1280 dimensions", () => {
    const wf = buildLTXFlf2vWorkflow(prompt, firstFrame, lastFrame, duration, fps, prefix);
    expect((wf["129:113"] as any).inputs.value).toBe(720);
    expect((wf["129:98"] as any).inputs.value).toBe(1280);
  });
});
