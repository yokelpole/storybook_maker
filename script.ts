import { mkdir, writeFile, copyFile, access } from "node:fs/promises";
import { program } from "commander";
import {
  setStableDiffusionModelCheckpoint,
  getStableDiffusionImages,
} from "./apis";
import { getTemplate } from "./template/templateGenerator";
import { WebUiManager } from "./WebUiManager";
import { StoryMetadata, StoryPage } from "./types";
import { createStory, createTitlePageStoryPage } from "./storyMaker";

program
  .option("-m, --model <model>", "ollama model to use", "mistral")
  /* 
    List:
      - cyberrealistic_classicV31, dreamshaper_8, LZ-16K+Optics, realismEngine_v10
      - v1-5-pruned
  */
  .option(
    "-msd, --modelStableDiffusion <model>",
    "stable diffusion model to use",
    "dreamshaper_8"
  )
  .option("-g, --genre <title>", "genre of the story", "children's story")
  .option(
    "-p, --storyPlot <prompt>",
    "suggested plot for the hero of the story",
    ""
  )
  .option("-h, --hero <name>", "name of the protagonist", "Gavin")
  .option(
    "-hg, --heroGender <male|female>",
    "gender of the protagonist",
    "male"
  )
  .option(
    "-htags, --heroTags <description>",
    "tag based description of the protagonist for rendering",
    "toddler"
  )
  .option(
    "-hd, --heroDescription <description>",
    "description of the protagonist for the story",
    "a boy toddler"
  )
  .option("-sh, --support <name>", "name of the supporting character", "")
  .option(
    "-sg, --supportGender <male|female>",
    "gender of the supporting character",
    ""
  )
  .option(
    "-stags, --supportTags <description>",
    "tag based description of the supporting character for rendering",
    ""
  )
  .option(
    "-sd, --supportDescription <description>",
    "description of the supporting character for the story",
    ""
  )
  .option("-l, --lora <lora>", "lora to use for the hero", "gavin-15")
  .option(
    "-sl, --supportLora <name>",
    "lora to use for the supporting character",
    ""
  )
  .option("-pg, --pages <page>", "number of pages to generate", "5")
  .option(
    "-pr, --prompt <prompt>",
    `additional details to provide to the prompt - should just specify what the overall image looks like`,
    "8k, high resolution, high quality"
  )
  .option("-s, --sampler <sampler>", "sampler to use", "DPM++ 2M Karras")
  .option("-st, --steps <steps>", "number of steps to use in rendering", "40")
  .option("-x, --width <width>", "width of the image", "512")
  .option("-y, --height <height>", "height of the image", "512")
  .parse();

async function makeStory() {
  const opts = program.opts();
  console.log("Options: ", opts);

  const {
    model,
    modelStableDiffusion,
    genre,
    storyPlot,
    hero,
    heroGender,
    heroDescription,
    heroTags: inputHeroTags,
    support,
    supportGender,
    supportDescription,
    supportTags: inputSupportTags,
    lora,
    supportLora,
    pages,
    prompt,
    sampler,
    steps,
    width,
    height,
  }: {
    model: string;
    modelStableDiffusion: string;
    genre: string;
    storyPlot: string;
    hero: string;
    heroGender: string;
    heroDescription: string;
    heroTags: string;
    lora: string;
    support: string;
    supportGender: string;
    supportDescription: string;
    supportTags: string;
    supportLora: string;
    pages: string;
    prompt: string;
    sampler: string;
    steps: string;
    width: string;
    height: string;
  } = program.opts();

  const heroTags = `${heroGender}, ${inputHeroTags}`;
  const supportTags = `${supportGender}, ${inputSupportTags}`;

  // Ensure that the targeted lora exists. Saves us time if something went wrong.
  await access(
    `/home/kyle/Development/stable_diffusion/stable-diffusion-webui/models/Lora/${lora}.safetensors`
  );

  const directoryPath = Math.floor(Date.now() / 1000).toString();
  await mkdir(`./stories/${directoryPath}`, { recursive: true });

  const { story, title, characterDescriptionMap, ollamaContext } =
    await createStory({
      genre,
      storyPlot,
      hero,
      heroDescription,
      heroTags,
      support,
      supportDescription,
      supportTags,
      supportLora,
      lora,
      pages: Number(pages),
      model,
    });

  const webUi = new WebUiManager();
  await webUi.startProcess();

  const imageBlobs: Buffer[][] = [];

  // Set the appropriate model.
  await setStableDiffusionModelCheckpoint(modelStableDiffusion);

  const titlePageStoryPage: StoryPage = await createTitlePageStoryPage({
    title,
    hero,
    heroTags,
    support,
    supportTags,
    model,
    characterDescriptionMap,
    ollamaContext,
    lora,
  });

  const titlePageImages = await getStableDiffusionImages({
    prompt,
    steps,
    width,
    height,
    sampler,
    storyPage: titlePageStoryPage,
    useRegions: !!(hero && support),
  });

  for (const [index, storyPage] of story.entries()) {
    console.log(storyPage);

    const images = await getStableDiffusionImages({
      prompt,
      steps,
      width,
      height,
      storyPage,
      sampler,
      useRegions: !!(storyPage.heroPrompt && storyPage.supportPrompt),
    });

    for (const [imageIndex, image] of images.entries()) {
      await writeFile(
        `./stories/${directoryPath}/${index}-${imageIndex}.png`,
        Buffer.from(image as string, "base64")
      );
      if (!imageBlobs[index])
        imageBlobs[index] = [Buffer.from(image as string, "base64")];
      else imageBlobs[index].push(Buffer.from(image as string, "base64"));
    }
  }

  await Promise.all([
    writeFile(
      `./stories/${directoryPath}/index.html`,
      getTemplate({
        pages: story,
        isEdited: false,
        title: titlePageStoryPage.paragraph,
        hero,
        support,
      })
    ),
    ...titlePageImages.map((image, index) =>
      writeFile(
        `./stories/${directoryPath}/title-${index}.png`,
        Buffer.from(image as string, "base64")
      )
    ),
    writeFile(`./stories/${directoryPath}/story.json`, JSON.stringify(story)),
    writeFile(
      `./stories/${directoryPath}/metadata.json`,
      JSON.stringify({
        titlePageStoryPage,
        hero,
        support,
        lora,
        steps,
        sampler,
        width,
        height,
        heroTags,
        prompt,
        useRegions: story.map((x) => !!(x.heroPrompt && x.supportPrompt)),
      } as StoryMetadata)
    ),
    copyFile(
      "./template/HobbyHorseNF.otf",
      `./stories/${directoryPath}/HobbyHorseNF.otf`
    ),
  ]);

  webUi.stopProcess();
  return 0;
}

makeStory();
