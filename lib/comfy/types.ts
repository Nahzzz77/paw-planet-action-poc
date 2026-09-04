export type ComfyApiNode = {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
};

export type ComfyApiWorkflow = Record<string, ComfyApiNode>;

export type ComfyUploadResult = {
  name: string;
  subfolder: string;
  type: string;
};

export type ComfyImageOutput = {
  filename: string;
  subfolder: string;
  type: string;
};

export type ComfyPromptResult = {
  prompt_id?: string;
  number?: number;
  node_errors?: Record<string, unknown>;
  error?: { message?: string } | string;
};
