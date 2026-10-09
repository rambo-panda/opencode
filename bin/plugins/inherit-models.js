const MODEL_MODALITIES = {
  "deepseek-v4.1-flash": ["text", "image", "pdf"],

  "glm-5v-turbo": ["text", "image", "video", "pdf"],
  "glm-5.3-flash": ["text", "image", "video", "pdf"],

  "gpt-5.6": ["text", "image", "pdf"],
  "gpt-5.6-luna": ["text", "image", "pdf"],
  "gpt-5.6-sol": ["text", "image", "pdf"],
  "gpt-5.6-terra": ["text", "image", "pdf"],
  "gpt-6-astra": ["text", "image", "pdf"],
  "gpt-5.5": ["text", "image", "pdf"],
  "gpt-5.4": ["text", "image", "pdf"],
  "gpt-5.4-mini": ["text", "image"],
  "gpt-5.3-codex-spark": ["text", "image", "pdf"],

  "kimi-k3": ["text", "image", "video"],

  "qwen3.8-max": ["text", "image", "video", "pdf"],
  "qwen3.8-flash": ["text", "image", "video"],
  "qwen3.7-plus": ["text", "image", "video"],
  "qwen3.6-plus": ["text", "image", "video"],

  "claude-fable-5": ["text", "image", "pdf"],
  "claude-haiku-4-5-20251001": ["text", "image", "pdf"],
  "claude-opus-5": ["text", "image", "pdf"],
  "claude-opus-4-8": ["text", "image", "pdf"],
  "claude-opus-4-7": ["text", "image", "pdf"],
  "claude-opus-4-6": ["text", "image", "pdf"],
  "claude-opus-4-5-20251101": ["text", "image", "pdf"],
  "claude-sonnet-5": ["text", "image", "pdf"],
  "claude-sonnet-4-6": ["text", "image", "pdf"],
  "claude-sonnet-4-5-20250929": ["text", "image", "pdf"],
}

export default {
  id: "personal.inherit-models",
  async setup(ctx) {
    await ctx.model.transform((models) => {
      for (const model of models.list()) {
        const input = MODEL_MODALITIES[model.id]
        if (!input) continue
        models.update(model.providerID, model.id, (entry) => {
          entry.capabilities.input = [...input]
          entry.capabilities.output = ["text"]
        })
      }
    })
  },
}
