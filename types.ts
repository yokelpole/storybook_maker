export type StoryPage = {
  paragraph: string;
  heroPrompt?: string;
  supportPrompt?: string;
  background: string;
};

export type StoryMetadata = {
  lora: string;
  steps: string;
  sampler: string;
  width: string;
  height: string;
  heroTags: string;
  useRegions: boolean[];
  prompt: string;
  titlePageStoryPage: StoryPage;
  hero: string;
  support?: string;
};
