import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

const provider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-7d55ea35785355a8d9136d06bca4b803',
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.asxs.top/v1',
});

const model = provider.chat(process.env.OPENAI_MODEL || 'gpt-5.4');

const prompt = [
  'Return a JSON object only.',
  'Create 2 storyboard shots for a forest race scene between a rabbit and a turtle.',
  'Each shot must have sequence, sceneDescription, startFrame, endFrame, motionScript, duration, dialogues.',
].join('\n');

try {
  const result = await generateText({
    model,
    system: 'You are a helpful assistant that returns JSON only.',
    prompt,
    providerOptions: {
      openai: {
        response_format: { type: 'json_object' },
      },
    },
  });
  console.log(JSON.stringify({ ok: true, text: result.text }, null, 2));
} catch (err) {
  console.error('ERR_NAME', err?.name);
  console.error('ERR_MESSAGE', err?.message);
  console.error('ERR_CAUSE', err?.cause);
  console.error('ERR_FULL', err);
  process.exit(1);
}
